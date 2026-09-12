import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';
import type { ConnectorResult } from '../../../connectors/types.js';

describe('TriggerEngine in-flight polling stop checkpoints', () => {
  it('aborts a pending read and permits a fresh tick even when the connector ignores abort', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    let signal: AbortSignal | undefined;
    let release!: (value: ConnectorResult) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<ConnectorResult>((resolve) => { release = resolve; });
    let reads = 0;
    runtime.connectors.gmail = { name: 'gmail', async execute(_action, _params, ctx) {
      reads += 1;
      if (reads === 1) { signal = ctx.abortSignal; entered(); return pending; }
      return { ok: true, data: { events: [], cursor: { initialized: true, historyId: 'fresh' } } };
    } };
    const engine = new TriggerEngine(store, runtime);
    const oldTick = engine.tick();
    await started;
    try {
      await engine.stop();
      expect(signal?.aborted).toBe(true);
      await engine.tick();
      expect(reads).toBe(2);
      release({ ok: true, data: { events: [], cursor: { initialized: true, historyId: 'stale' } } });
      await oldTick;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(store.getSetting<Record<string, { historyId?: string }>>('trigger.cursors', {})[workflowId]?.historyId).toBe('fresh');
    } finally {
      release({ ok: true, data: { events: [], cursor: {} } });
      await oldTick;
      await engine.stop();
      db.close?.();
    }
  });

  it('checkpoints a successful poll execution when stopped while it is in flight', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const slack = mockSlack(runtime.connectors);
    const execute = slack.execute.bind(slack);
    let releaseExecution!: () => void;
    let markExecutionStarted!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    runtime.connectors.slack = {
      name: slack.name,
      async execute(action, params, ctx) {
        markExecutionStarted();
        await executionReleased;
        return execute(action, params, ctx);
      },
    };

    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);
    await engine.tick();
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-during-stop',
      from: 'sender@example.com',
      subject: '중지 중 완료',
      body: '한 번만 처리되어야 하는 메일',
    });

    const tick = engine.tick();
    await executionStarted;
    const stop = engine.stop();
    releaseExecution();
    await Promise.all([tick, stop]);

    expect(slack.messages).toHaveLength(1);
    expect(store.getSetting<{ seenMessageIds?: string[] }>('trigger.cursors', {})[workflowId]?.seenMessageIds)
      .toContain('msg-during-stop');
    expect(db.prepare('SELECT status FROM trigger_receipts').get()).toEqual({ status: 'completed' });

    await engine.tick();
    expect(slack.messages).toHaveLength(1);
  });
});

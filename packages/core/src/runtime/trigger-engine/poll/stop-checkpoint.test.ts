import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine in-flight polling stop checkpoints', () => {
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

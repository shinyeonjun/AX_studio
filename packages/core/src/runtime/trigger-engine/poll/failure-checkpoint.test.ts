import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine failed polling execution checkpoints', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('does not advance a poll cursor when workflow execution fails, and retries after backoff', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const slack = mockSlack(runtime.connectors);
    let attempts = 0;
    runtime.connectors.slack = {
      name: slack.name,
      async execute(action, params, ctx) {
        if (action === 'message.send' && attempts++ === 0) {
          return { ok: false, error: 'temporary Slack failure', errorCode: 'temporary_failure' };
        }
        return slack.execute(action, params, ctx);
      },
    };

    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-retry',
      from: 'sender@example.com',
      subject: '재시도',
      body: '처리되어야 하는 메일',
    });

    await engine.tick();
    expect(slack.messages).toHaveLength(0);
    const afterFailure = store.getSetting<Record<string, { seenMessageIds?: string[] }>>('trigger.cursors', {})[workflowId];
    expect(afterFailure?.seenMessageIds).not.toContain('msg-retry');

    // Still inside the exponential backoff window: no retry yet.
    await engine.tick();
    expect(slack.messages).toHaveLength(0);

    vi.setSystemTime(new Date('2026-10-06T00:00:31.000Z'));
    await engine.tick();
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.channel).toBe('#inbox');
  });
});

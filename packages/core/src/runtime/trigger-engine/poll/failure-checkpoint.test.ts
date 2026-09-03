import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine failed polling execution checkpoints', () => {
  it('does not advance a poll cursor when workflow execution fails', async () => {
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
    const afterFailure = store.getSetting<{ seenMessageIds?: string[] }>('trigger.cursors', {})[workflowId];
    expect(afterFailure?.seenMessageIds).not.toContain('msg-retry');

    await engine.tick();
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.channel).toBe('#inbox');
  });
});

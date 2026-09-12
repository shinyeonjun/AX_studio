import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { gmailNotifySkill } from './fixtures.js';

describe('TriggerEngine failed polling execution checkpoints', () => {
  it.each(['before-send', 'uncertain-send'] as const)('handles %s failure without losing retry safety', async (failure) => {
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
        if (failure === 'uncertain-send' && action === 'message.send' && attempts++ === 0) {
          return { ok: false, error: 'temporary Slack failure', errorCode: 'temporary_failure' };
        }
        return slack.execute(action, params, ctx);
      },
    };

    if (failure === 'before-send') {
      runtime.connectors.http = {
        name: 'controlled-http',
        async execute() {
          return attempts++ === 0
            ? { ok: false, error: 'temporary read failure' }
            : { ok: true, data: { status: 200, statusText: 'OK', body: 'ready', url: 'https://fixture.invalid/status', headers: {} } };
        },
      };
    }
    const { workflowId } = store.saveWorkflow({ ...gmailNotifySkill, steps: [
      ...(failure === 'before-send' ? [{ type: 'action' as const, id: 'read', connector: 'http', action: 'request',
        params: { method: 'GET', path: '/status' }, sideEffect: 'NONE' as const }] : []),
      ...gmailNotifySkill.steps,
    ] });
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
    if (failure === 'before-send') {
      expect(afterFailure?.seenMessageIds).not.toContain('msg-retry');
      await engine.tick();
      expect(slack.messages).toHaveLength(1);
      expect(slack.messages[0]?.channel).toBe('#inbox');
    } else {
      // A transport failure after a send started does not establish non-delivery.
      expect(afterFailure?.seenMessageIds).toContain('msg-retry');
      await engine.tick();
      expect(attempts).toBe(1);
      expect(slack.messages).toHaveLength(0);
      expect(store.listExecutions()[0]?.status).toBe('failed');
    }
    await engine.stop();
    db.close?.();
  });
});

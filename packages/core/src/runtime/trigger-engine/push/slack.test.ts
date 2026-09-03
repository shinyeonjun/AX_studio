import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

describe('TriggerEngine Slack push transport', () => {
  it('fires once for each new channel message', async () => {
    const slackNotifySkill: WorkflowIR = {
      name: 'Slack 알림',
      goal: 'Slack 새 메시지 시 알림 채널로 전달',
      version: 1,
      trigger: { type: 'slack.new_message', channel: '#general' },
      inputs: ['text', 'user', 'channel'],
      steps: [{
        type: 'action',
        id: 'notify',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#alerts', text: 'new slack message' },
        sideEffect: 'EXTERNAL',
      }],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    mockSlack(runtime.connectors).inbound.push({
      channel: '#general',
      text: '기존 메시지',
      ts: '100.000',
      user: 'U_OLD',
    });

    const { workflowId } = store.saveWorkflow(slackNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    mockSlack(runtime.connectors).inbound.push({
      channel: '#general',
      text: '새 메시지',
      ts: '101.000',
      user: 'U_NEW',
    });

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.channel).toBe('#alerts');

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });
});

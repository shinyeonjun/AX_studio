import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createAgentHarness, createInvestigationRunner } from '../../../agent/harness.js';
import { createTestConnectors, mockSlack } from '../../../modules/test-connectors.js';
import { NoReadProvider } from '../fixtures.js';

describe('runtime output binding', () => {

  it('binds an unconfigured Slack message to the preceding AI conclusion before approval', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const connectors = createTestConnectors();
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors,
      investigationRunner: createInvestigationRunner(createAgentHarness(new NoReadProvider())),
    });

    const first = await runtime.executeWorkflow({
      name: '결제 결과 공유',
      goal: '결제 주문을 요약해서 Slack으로 공유',
      version: 1,
      steps: [
        {
          type: 'ai_decision',
          id: 'brief',
          goal: '결제 주문을 요약',
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          actionRef: 'slack.message.send',
          params: { channel: 'CORBC7MDFE73' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    }, { ephemeral: true, triggerType: 'manual', workspaceSessionId: 'chat-1' });

    expect(first.status).toBe('pending_approval');
    expect(mockSlack(connectors).messages).toHaveLength(0);

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);

    expect(resumed.status).toBe('success');
    expect(mockSlack(connectors).messages).toEqual([{
      channel: 'CORBC7MDFE73',
      text: '주간 보고 결과',
    }]);
  });
});

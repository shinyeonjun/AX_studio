import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { createTestConnectors, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { NoReadProvider } from '../fixtures.js';
import type { MessageToolDraft } from '../../../contracts/tool-result.js';

describe('runtime output binding', () => {

  it('binds an unconfigured Slack message to the preceding AI conclusion before approval', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic Slack binding fixture' }] });
    store.setConnection('slack', true);
    const connectors = createTestConnectors();
    const slack = mockSlack(connectors);
    connectors.slack!.prepareMessageSend = vi.fn(async (draft: MessageToolDraft) => {
      expect(draft).toEqual({ tool: 'slack', channel: 'CORBC7MDFE73', text: '주간 보고 결과' });
      return { provider: 'slack' as const, accountId: 'U12345678', accountLabel: 'Synthetic sender',
        workspaceId: 'T12345678', workspaceLabel: 'Synthetic workspace',
        destinationId: 'CORBC7MDFE73', destinationLabel: '#synthetic' };
    });
    const execute = slack.execute.bind(slack);
    const send = vi.spyOn(slack, 'execute').mockImplementation(async (action, params, ctx) => {
      const result = await execute(action, params, ctx);
      return action === 'message.send' && result.ok
        ? { ...result, data: { ...(result.data as { channel: string; text: string }), ts: '100.001' } }
        : result;
    });
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
      inputs: [],
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
    }, { ephemeral: true, triggerType: 'manual', workspaceSessionId: session.id });

    expect(first.status).toBe('pending_approval');
    expect(mockSlack(connectors).messages).toHaveLength(0);

    const approvalId = first.pendingApprovalId!;
    const unconfirmed = await runtime.continueAfterApproval(approvalId);
    expect(unconfirmed.errorCode).toBe('tool_result_confirmation_required');
    expect(store.getApproval(approvalId)?.status).toBe('pending');
    expect(send).not.toHaveBeenCalled();

    const review = await runtime.reviewToolResult({ approvalId, workspaceSessionId: session.id, revision: 0 });
    expect(review.draft).toEqual({ tool: 'slack', channel: 'CORBC7MDFE73', text: '주간 보고 결과' });
    expect(review.binding).toMatchObject({ workspaceId: 'T12345678', destinationId: 'CORBC7MDFE73' });
    const resumed = await runtime.continueAfterApproval(approvalId, review.confirmation);

    expect(resumed.status).toBe('success');
    expect(resumed.errorCode).toBeUndefined();
    expect(resumed.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: '100.001' });
    expect(mockSlack(connectors).messages).toEqual([{
      channel: 'CORBC7MDFE73',
      text: '주간 보고 결과',
    }]);
    expect(send).toHaveBeenCalledOnce();
    expect((await runtime.continueAfterApproval(approvalId, review.confirmation)).status).toBe('failed');
    expect(send).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { createTestConnectors, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { NoReadProvider } from '../fixtures.js';
import type { MessageToolDraft } from '../../../contracts/tool-result.js';

describe('runtime output binding', () => {

  it.each([true, false])('infers Slack text through a legacy approval node; unsupported message field: %s', async unsupportedMessage => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic legacy approval binding fixture' }] });
    store.setConnection('slack', true);
    const connectors = createTestConnectors();
    const slack = mockSlack(connectors);
    const prepare = vi.fn(async (draft: MessageToolDraft) => {
      expect(draft).toEqual({ tool: 'slack', channel: 'CORBC7MDFE73', text: '주간 보고 결과' });
      return { provider: 'slack' as const, accountId: 'U12345678', accountLabel: 'Synthetic sender',
        workspaceId: 'T12345678', workspaceLabel: 'Synthetic workspace',
        destinationId: 'CORBC7MDFE73', destinationLabel: '#synthetic' };
    });
    connectors.slack!.prepareMessageSend = prepare;
    const execute = slack.execute.bind(slack);
    const send = vi.spyOn(slack, 'execute').mockImplementation(async (action, params, ctx) => {
      const result = await execute(action, params, ctx);
      return action === 'message.send' && result.ok
        ? { ...result, data: { ...(result.data as { channel: string; text: string }), ts: '100.001' } }
        : result;
    });
    const httpExecute = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: '{"orders":[{"id":"order-1003","amount":410000},{"id":"order-1001","amount":125000}]}',
        truncated: false,
        url: 'http://test.local/api/v1/orders?status=paid',
      },
    }));
    connectors.http = { name: 'http', execute: httpExecute };
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors,
      investigationRunner: createInvestigationRunner(createAgentHarness(new NoReadProvider())),
    });

    const first = await runtime.executeWorkflow({
      name: '결제 주문 공유',
      goal: '결제 완료 주문을 금액순으로 정리해 Slack으로 공유',
      version: 1,
      inputs: [],
      steps: [
        {
          type: 'action',
          id: 'fetch_orders',
          connector: 'http',
          action: 'request',
          actionRef: 'http.request@1',
          params: { connectionId: 'test-http', path: '/api/v1/orders?status=paid' },
          sideEffect: 'NONE',
        },
        {
          type: 'ai_decision',
          id: 'brief',
          goal: '결제 완료 주문을 금액순으로 요약',
          investigation: false,
          maxReads: 1,
          outputSchema: {
            type: 'object',
            properties: { conclusion: { type: 'string', purpose: 'prose' } },
            required: ['conclusion'],
          },
        },
        {
          type: 'human_approval',
          id: 'approve_share',
          reason: 'Slack 공유 승인',
          forActionIds: ['notify'],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          actionRef: 'slack.message.send',
          params: { channel: 'CORBC7MDFE73', ...(unsupportedMessage ? { message: '모델이 사용한 비표준 본문 키' } : {}) },
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

    expect(httpExecute).toHaveBeenCalledOnce();
    const snapshot = JSON.parse(store.getExecution(first.executionId)?.irJson ?? '{}') as WorkflowIR;
    const notifySnapshot = snapshot.steps.find(
      (step): step is Extract<Step, { type: 'action' }> => step.type === 'action' && step.id === 'notify',
    );
    expect(notifySnapshot?.bindings?.text).toMatchObject({ from: 'brief', output: 'conclusion' });
    expect(first.errorCode).toBeUndefined();
    expect(first.status).toBe('pending_approval');
    expect(mockSlack(connectors).messages).toHaveLength(0);

    const approvalId = first.pendingApprovalId!;
    const unconfirmed = await runtime.continueAfterApproval(approvalId);
    expect(unconfirmed.errorCode).toBe('tool_result_confirmation_required');
    expect(store.getApproval(approvalId)?.status).toBe('pending');
    expect(send).not.toHaveBeenCalled();

    const source = runtime.getToolResult(approvalId);
    expect(source?.draft).toEqual({ tool: 'slack', channel: 'CORBC7MDFE73', text: '주간 보고 결과' });
    expect(source?.blockedFields).toEqual(unsupportedMessage ? ['message'] : []);
    const request = { approvalId, workspaceSessionId: session.id, revision: 0 };
    if (unsupportedMessage) {
      expect(notifySnapshot?.params.message).toBe('모델이 사용한 비표준 본문 키');
      await expect(runtime.reviewToolResult(request)).rejects.toThrow('tool_result_unsupported_fields');
      expect(prepare).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(store.getApproval(approvalId)?.status).toBe('pending');
      expect(mockSlack(connectors).messages).toHaveLength(0);
      return;
    }

    const review = await runtime.reviewToolResult(request);
    expect(review.draft).toEqual(source!.draft);
    expect(review.binding).toMatchObject({ workspaceId: 'T12345678', destinationId: 'CORBC7MDFE73' });
    const resumed = await runtime.continueAfterApproval(approvalId, review.confirmation);

    expect(resumed.status).toBe('success');
    expect(resumed.errorCode).toBeUndefined();
    expect(resumed.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: '100.001' });
    expect(mockSlack(connectors).messages).toEqual([{
      channel: 'CORBC7MDFE73',
      text: '주간 보고 결과',
    }]);
    expect(prepare).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect((await runtime.continueAfterApproval(approvalId, review.confirmation)).status).toBe('failed');
    expect(send).toHaveBeenCalledOnce();
  });
});

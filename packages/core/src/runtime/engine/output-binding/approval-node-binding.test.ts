import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { createAgentHarness, createInvestigationRunner } from '../../../agent/harness.js';
import { createTestConnectors, mockSlack } from '../../../modules/test-connectors.js';
import { NoReadProvider } from '../fixtures.js';

describe('runtime output binding', () => {

  it('infers Slack text through an approval node when the model emits message', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const connectors = createTestConnectors();
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
            properties: { summary: { type: 'string' } },
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
          params: { channel: 'CORBC7MDFE73', message: '모델이 사용한 비표준 본문 키' },
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

    expect(httpExecute).toHaveBeenCalledOnce();
    const snapshot = JSON.parse(store.getExecution(first.executionId)?.irJson ?? '{}') as WorkflowIR;
    const notifySnapshot = snapshot.steps.find(
      (step): step is Extract<Step, { type: 'action' }> => step.type === 'action' && step.id === 'notify',
    );
    expect(notifySnapshot?.bindings?.text).toMatchObject({ from: 'brief', output: 'conclusion' });
    expect(first.errorCode).toBeUndefined();
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

import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import type { ExecutionResult } from './types.js';
import { publishExecutionResultToWorkspaceChat } from './execution-result-message.js';

function executionIr(name = '결제 요약') {
  return JSON.stringify({
    id: 'workflow-1',
    name,
    goal: '결제 본문을 요약하고 알린다',
    version: 1,
    steps: [
      {
        type: 'ai_decision',
        id: 'summarize',
        goal: '요약',
        investigation: false,
        maxReads: 1,
      },
      {
        type: 'action',
        id: 'send',
        connector: 'slack',
        action: 'message.send',
        params: {},
        sideEffect: 'EXTERNAL',
      },
    ],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  });
}

function createExecution(store: WorkflowStore, irJson = executionIr()) {
  return store.createExecution({
    workflowId: 'workflow-1',
    workflowVersion: 1,
    ephemeral: false,
    triggerType: 'webhook.inbound',
    irJson,
  });
}

function result(executionId: string, status: ExecutionResult['status'], log: ExecutionResult['log']): ExecutionResult {
  return { executionId, status, log };
}

describe('workflow execution conversation result', () => {
  it('writes one bounded assistant result to the mapped chat without copying raw payload data', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({
      workflowId: 'workflow-1',
      messages: [{ role: 'user', content: '결제 업무를 만들어줘' }],
    });
    const executionId = createExecution(store);
    const log: ExecutionResult['log'] = [
      {
        at: '2026-08-31T00:00:00.000Z',
        level: 'info',
        code: 'ai_decision_completed',
        message: 'AI 분석 완료',
        data: {
          outputPreview: {
            conclusion: 'inv_acme_1001 결제가 완료되었습니다.',
            category: 'paid',
            body: 'raw-provider-secret-body',
          },
        },
      },
      {
        at: '2026-08-31T00:00:01.000Z',
        level: 'info',
        code: 'step_completed',
        message: '단계를 완료했습니다.',
        data: { stepId: 'send' },
      },
    ];
    store.finishExecution(executionId, 'success', undefined, log);

    const event = publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));

    expect(event).toEqual({
      sessionId: chat.id,
      workflowId: 'workflow-1',
      executionId,
    });
    const messages = store.getWorkspaceChat(chat.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      kind: 'execution_result',
      executionId,
      executionStatus: 'success',
    });
    expect(messages[1]?.content).toContain('실행이 완료되었습니다');
    expect(messages[1]?.content).toContain('inv_acme_1001 결제가 완료되었습니다.');
    expect(messages[1]?.content).toContain('Slack 메시지 완료');
    expect(messages[1]?.content).not.toContain('raw-provider-secret-body');

    publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));
    expect(store.getWorkspaceChat(chat.id)?.messages).toHaveLength(2);
  });

  it('updates a pending result in place when the same execution later completes', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ workflowId: 'workflow-1', messages: [] });
    const executionId = createExecution(store);

    const pendingLog: ExecutionResult['log'] = [{
      at: '2026-08-31T00:00:00.000Z',
      level: 'warn',
      code: 'waiting_approval',
      message: '승인을 기다리고 있습니다.',
    }];
    publishExecutionResultToWorkspaceChat(store, result(executionId, 'pending_approval', pendingLog));
    const pending = store.getWorkspaceChat(chat.id)?.messages[0]?.content ?? '';
    expect(pending).toContain('승인 대기 중입니다');

    const completedLog: ExecutionResult['log'] = [{
      at: '2026-08-31T00:00:01.000Z',
      level: 'info',
      code: 'step_completed',
      message: '단계를 완료했습니다.',
      data: { stepId: 'send' },
    }];
    publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', completedLog));

    const messages = store.getWorkspaceChat(chat.id)?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('실행이 완료되었습니다');
    expect(messages[0]?.content).not.toContain('승인 대기 중입니다');
  });

  it('projects an ephemeral execution result into its originating chat', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({
      messages: [{ role: 'user', content: '이번 결과를 이 대화에 남겨줘' }],
    });
    const executionId = store.createExecution({
      ephemeral: true,
      workspaceSessionId: chat.id,
      triggerType: 'manual',
      irJson: executionIr('일회 공유'),
    });
    const log: ExecutionResult['log'] = [{
      at: '2026-08-31T00:00:00.000Z',
      level: 'info',
      code: 'step_completed',
      message: '단계를 완료했습니다.',
      data: { stepId: 'send' },
    }];
    store.finishExecution(executionId, 'success', undefined, log);

    const event = publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));

    expect(event).toEqual({ sessionId: chat.id, executionId });
    expect(store.getWorkspaceChat(chat.id)?.messages).toHaveLength(2);
    expect(store.getWorkspaceChat(chat.id)?.messages[1]).toMatchObject({
      kind: 'execution_result',
      executionId,
      executionStatus: 'success',
    });
  });

  it('projects inline approval only for a pending ephemeral execution', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const oneShotChat = store.saveWorkspaceChat({
      messages: [{ role: 'user', content: '결제 요약을 한 번 공유해줘' }],
    });
    const oneShotExecutionId = store.createExecution({
      ephemeral: true,
      workspaceSessionId: oneShotChat.id,
      triggerType: 'manual',
      irJson: executionIr('일회 공유'),
    });
    const approvalId = store.createApproval({
      executionId: oneShotExecutionId,
      actionIds: ['send'],
      reason: '외부 작업 승인 필요: slack.message.send@1',
      payload: { checkpoint: { remainingStepIds: ['send'] } },
    });
    const pendingLog: ExecutionResult['log'] = [{
      at: '2026-08-31T00:00:00.000Z',
      level: 'warn',
      code: 'waiting_approval',
      message: '승인을 기다리고 있습니다.',
    }];

    publishExecutionResultToWorkspaceChat(store, {
      executionId: oneShotExecutionId,
      status: 'pending_approval',
      pendingApprovalId: approvalId,
      log: pendingLog,
    });

    const oneShotMessage = store.getWorkspaceChat(oneShotChat.id)?.messages.at(-1);
    expect(oneShotMessage).toMatchObject({
      kind: 'execution_result',
      executionStatus: 'pending_approval',
      approval: {
        id: approvalId,
        reason: '외부 작업 승인 필요: slack.message.send@1',
      },
    });
    expect(oneShotMessage?.approval?.title).toBeTruthy();

    publishExecutionResultToWorkspaceChat(store, {
      executionId: oneShotExecutionId,
      status: 'cancelled',
      errorCode: 'approval_rejected',
      log: [],
    });
    expect(store.getWorkspaceChat(oneShotChat.id)?.messages.at(-1)?.approval).toBeUndefined();

    const recurringChat = store.saveWorkspaceChat({
      workflowId: 'workflow-1',
      messages: [{ role: 'user', content: '반복 공유 결과' }],
    });
    const recurringExecutionId = store.createExecution({
      workflowId: 'workflow-1',
      ephemeral: false,
      triggerType: 'schedule',
      irJson: executionIr('반복 공유'),
    });
    const recurringApprovalId = store.createApproval({
      executionId: recurringExecutionId,
      actionIds: ['send'],
      reason: '외부 작업 승인 필요: slack.message.send@1',
    });
    publishExecutionResultToWorkspaceChat(store, {
      executionId: recurringExecutionId,
      status: 'pending_approval',
      pendingApprovalId: recurringApprovalId,
      log: pendingLog,
    });

    const recurringMessage = store.getWorkspaceChat(recurringChat.id)?.messages.at(-1);
    expect(recurringMessage?.executionStatus).toBe('pending_approval');
    expect(recurringMessage?.approval).toBeUndefined();
  });

  it('does not create a phantom chat when the workflow has no mapped session', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = createExecution(store);

    expect(publishExecutionResultToWorkspaceChat(store, result(executionId, 'failed', []))).toBeNull();
    expect(store.listWorkspaceChats()).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import type { ExecutionResult } from '../types.js';
import { publishExecutionResultToWorkspaceChat } from '../execution-result-message.js';
import { executionIr } from './fixtures.js';

describe('workflow execution conversation result approval projection', () => {
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
});

import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { publishExecutionResultToWorkspaceChat } from '../../execution-result-message.js';
import { executionIr, result } from '../fixtures.js';
describe('ephemeral execution result projection', () => {
  it('projects an ephemeral execution result into its originating chat', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '이번 결과를 이 대화에 남겨줘' }] });
    const executionId = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id, triggerType: 'manual', irJson: executionIr('일회 공유') });
    const log = [{ at: '2026-08-31T00:00:00.000Z', level: 'info' as const, code: 'step_completed', message: '단계를 완료했습니다.', data: { stepId: 'send' } }];
    store.finishExecution(executionId, 'success', undefined, log);
    const event = publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));
    expect(event).toEqual({ sessionId: chat.id, executionId });
    expect(store.getWorkspaceChat(chat.id)?.messages).toHaveLength(2);
    expect(store.getWorkspaceChat(chat.id)?.messages[1]).toMatchObject({ kind: 'execution_result', executionId, executionStatus: 'success' });
  });
});

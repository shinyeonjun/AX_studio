import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import type { ExecutionResult } from '../../types.js';
import { publishExecutionResultToWorkspaceChat } from '../../execution-result-message.js';
import { createExecution, result } from '../fixtures.js';
describe('pending execution result projection', () => {
  it('updates a pending result in place when the same execution later completes', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ workflowId: 'workflow-1', messages: [] });
    const executionId = createExecution(store);
    const pendingLog: ExecutionResult['log'] = [{ at: '2026-08-31T00:00:00.000Z', level: 'warn', code: 'waiting_approval', message: '승인을 기다리고 있습니다.' }];
    publishExecutionResultToWorkspaceChat(store, result(executionId, 'pending_approval', pendingLog));
    const pending = store.getWorkspaceChat(chat.id)?.messages[0]?.content ?? '';
    expect(pending).toContain('승인 대기 중입니다');
    const completedLog: ExecutionResult['log'] = [{ at: '2026-08-31T00:00:01.000Z', level: 'info', code: 'step_completed', message: '단계를 완료했습니다.', data: { stepId: 'send' } }];
    publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', completedLog));
    const messages = store.getWorkspaceChat(chat.id)?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('실행이 완료되었습니다');
    expect(messages[0]?.content).not.toContain('승인 대기 중입니다');
  });
});

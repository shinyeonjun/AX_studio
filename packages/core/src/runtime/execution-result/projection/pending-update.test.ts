import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { ExecutionResult } from '../../types.js';
import { publishExecutionResultToWorkspaceChat } from '../../execution-result-message.js';
import { createExecution, result } from '../fixtures.js';
describe('pending execution result projection', () => {
  it('projects to the most recently updated chat mapped to a workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const older = store.saveWorkspaceChat({ workflowId: 'workflow-1', messages: [{ role: 'user', content: '이전 대화' }] });
    const latest = store.saveWorkspaceChat({ workflowId: 'workflow-1', messages: [{ role: 'user', content: '현재 대화' }] });
    db.prepare('UPDATE workspace_chats SET updated_at = ? WHERE id = ?').run('2026-09-24T00:00:00.000Z', older.id);
    db.prepare('UPDATE workspace_chats SET updated_at = ? WHERE id = ?').run('2026-09-25T00:00:00.000Z', latest.id);
    const executionId = createExecution(store);
    const log: ExecutionResult['log'] = [];
    store.finishExecution(executionId, 'success', undefined, log);

    const event = publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));

    expect(event?.sessionId).toBe(latest.id);
    expect(store.getWorkspaceChat(latest.id)?.messages.at(-1)?.executionId).toBe(executionId);
    expect(store.getWorkspaceChat(older.id)?.messages).toHaveLength(1);
  });

  it('updates a pending result in place when the same execution later completes', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ workflowId: 'workflow-1', messages: [] });
    const executionId = createExecution(store);
    const prepare = vi.spyOn(db, 'prepare');
    const pendingLog: ExecutionResult['log'] = [{ at: '2026-08-31T00:00:00.000Z', level: 'warn', code: 'waiting_approval', message: '승인을 기다리고 있습니다.' }];
    publishExecutionResultToWorkspaceChat(store, result(executionId, 'pending_approval', pendingLog));
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('FROM workspace_chats')).length).toBe(1);
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

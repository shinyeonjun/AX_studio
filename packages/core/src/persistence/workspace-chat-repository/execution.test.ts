import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace chat execution and workflow mapping', () => {
  it('reads the transcript only once when upserting an execution result', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({
      messages: [{ role: 'user', content: '업무를 실행해줘' }],
    });
    const prepare = vi.spyOn(db, 'prepare');

    store.upsertWorkspaceChatExecutionResult(chat.id, {
      role: 'assistant',
      kind: 'execution_result',
      executionId: 'run-once',
      content: '완료',
    });

    expect(prepare.mock.calls.filter(([sql]) => sql.includes('FROM workspace_chats WHERE id = ?'))).toHaveLength(1);
    expect(store.getWorkspaceChat(chat.id)?.messages.at(-1)?.executionId).toBe('run-once');
  });

  it('keeps the latest host result for the same execution during stale renderer saves', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    store.upsertWorkspaceChatExecutionResult(chat.id, {
      role: 'assistant', kind: 'execution_result', executionId: 'run',
      content: '승인 대기', executionStatus: 'pending_approval',
      approval: { id: 'approval', title: '승인', reason: '파일 생성' },
    });
    const stale = store.getWorkspaceChat(chat.id)!.messages;
    const completed = {
      role: 'assistant' as const, kind: 'execution_result' as const, executionId: 'run',
      content: '완료', executionStatus: 'success' as const,
      generatedPdf: { artifactId: 'pdf-result', fileName: 'report.pdf', size: 123, mimeType: 'application/pdf' as const },
    };
    store.upsertWorkspaceChatExecutionResult(chat.id, completed);
    const saved = store.saveWorkspaceChat({ id: chat.id, messages: [...stale, { role: 'user', content: '다음 작업도 해줘' }] });
    expect(saved.messages[0]).toEqual(completed);
    expect(store.getWorkspaceChat(chat.id)?.messages[0]).toEqual(completed);
    expect(saved.messages).toHaveLength(2);
    db.close?.();
  });
  it('preserves a background execution result when a stale transcript is saved later', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({
      workflowId: 'workflow-race',
      messages: [{ role: 'user', content: '업무를 실행해줘' }],
    });

    store.upsertWorkspaceChatExecutionResult(chat.id, {
      role: 'assistant',
      kind: 'execution_result',
      executionId: 'execution-race',
      content: '업무 실행이 완료되었습니다.',
    });
    store.saveWorkspaceChat({
      id: chat.id,
      messages: [
        { role: 'user', content: '업무를 실행해줘' },
        { role: 'assistant', content: '실행을 시작했습니다.' },
      ],
      workflowId: 'workflow-race',
    });

    expect(store.getWorkspaceChat(chat.id)?.messages).toEqual([
      { role: 'user', content: '업무를 실행해줘' },
      { role: 'assistant', content: '실행을 시작했습니다.' },
      {
        role: 'assistant',
        kind: 'execution_result',
        executionId: 'execution-race',
        content: '업무 실행이 완료되었습니다.',
      },
    ]);
  });

  it('finds the latest chat mapped to a workflow without a chat execution mode', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkspaceChat({
      workflowId: 'workflow-once',
      messages: [{ role: 'user', content: '업무를 실행해줘' }],
    });

    expect(store.getWorkspaceChat(saved.id)).not.toHaveProperty('executionMode');
    expect(store.getWorkspaceChatByWorkflowId('workflow-once')).toMatchObject({
      id: saved.id,
    });
    expect(store.getWorkspaceChatByWorkflowId('workflow-once')).not.toHaveProperty('executionMode');
  });

  it('preserves a workflow mapping when a later save omits workflowId', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkspaceChat({
      workflowId: 'workflow-persistent',
      messages: [{ role: 'user', content: '업무를 만들어줘' }],
    });

    store.saveWorkspaceChat({
      id: saved.id,
      messages: [
        { role: 'user', content: '업무를 만들어줘' },
        { role: 'assistant', content: '저장했습니다.' },
      ],
    });

    expect(store.getWorkspaceChatByWorkflowId('workflow-persistent')).toMatchObject({ id: saved.id });
    expect(store.saveWorkspaceChat({
      id: saved.id,
      messages: [{ role: 'user', content: '이제 연결을 해제해줘' }],
      workflowId: null,
    })).not.toHaveProperty('workflowId');
    expect(store.getWorkspaceChatByWorkflowId('workflow-persistent')).toBeNull();
  });
});

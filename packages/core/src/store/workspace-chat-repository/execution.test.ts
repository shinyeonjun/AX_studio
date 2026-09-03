import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace chat execution and workflow mapping', () => {
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

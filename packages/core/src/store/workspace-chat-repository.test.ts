import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import { WorkflowStore } from './workflow-store.js';

describe('workspace chat persistence boundary', () => {
  it('validates messages before writing them', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);

    expect(() =>
      store.saveWorkspaceChat({
        messages: [{ role: 'system', content: 'must be rejected' } as never],
      }),
    ).toThrow();
    expect(store.listWorkspaceChats()).toHaveLength(0);
  });

  it('marks corrupt rows in lists and fails closed when opening them', async () => {
    const db = await createDatabaseAsync(':memory:');
    db.prepare(
      'INSERT INTO workspace_chats (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('broken-workspace-chat', '깨진 대화', '{broken', 'now', 'now');
    const store = new WorkflowStore(db);

    expect(store.listWorkspaceChats()).toEqual([
      expect.objectContaining({ id: 'broken-workspace-chat', corrupted: true, messages: [] }),
    ]);
    expect(() => store.getWorkspaceChat('broken-workspace-chat')).toThrow(/corrupted/);
  });

  it('round-trips a valid workspace chat', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkspaceChat({
      workflowId: 'workflow-1',
      messages: [
        { role: 'user', content: '연결된 폴더를 확인해줘' },
        { role: 'assistant', content: '확인할게요.' },
      ],
    });

    expect(store.getWorkspaceChat(saved.id)).toMatchObject({
      id: saved.id,
      workflowId: 'workflow-1',
      messages: saved.messages,
    });
  });

  it('round-trips optional host-rendered presentation metadata with the assistant message', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkspaceChat({
      messages: [{
        role: 'assistant',
        content: '처리 전에 확인해 주세요.',
        inputRequests: [{ id: 'channel', label: 'Slack 채널', type: 'slack_channel' }],
        presentations: [{
          title: '확인 필요',
          blocks: [{ type: 'decision', label: '대상', value: '연결된 폴더' }],
          inputs: [],
          actions: [{ id: 'continue', label: '진행', value: '진행해줘' }],
        }],
      }],
    });

    expect(store.getWorkspaceChat(saved.id)?.messages[0]).toMatchObject({
      inputRequests: [{ id: 'channel', type: 'slack_channel' }],
      presentations: [{ title: '확인 필요', actions: [{ id: 'continue', value: '진행해줘' }] }],
    });
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

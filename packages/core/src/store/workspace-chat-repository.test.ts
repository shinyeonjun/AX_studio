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
      messages: [
        { role: 'user', content: '연결된 폴더를 확인해줘' },
        { role: 'assistant', content: '확인할게요.' },
      ],
    });

    expect(store.getWorkspaceChat(saved.id)).toMatchObject({ id: saved.id, messages: saved.messages });
  });
});

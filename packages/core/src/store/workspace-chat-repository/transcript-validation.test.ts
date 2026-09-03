import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace chat transcript validation', () => {
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
      'INSERT INTO workspace_chats (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('broken-workspace-chat', '깨진 대화', '{broken', 'now', 'now');
    const store = new WorkflowStore(db);

    expect(store.listWorkspaceChats()).toEqual([
      expect.objectContaining({ id: 'broken-workspace-chat', corrupted: true }),
    ]);
    expect(() => store.getWorkspaceChat('broken-workspace-chat')).toThrow(/corrupted/);
  });
});

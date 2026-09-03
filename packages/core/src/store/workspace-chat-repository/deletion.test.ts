import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace chat deletion', () => {
  it('deletes session source rows with their owning chat', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '자료를 지워줘' }] });
    store.insertWorkspaceSource({
      id: 'src_delete_test',
      sessionId: chat.id,
      artifactId: 'art_delete_test',
      fileName: 'delete.pdf',
      status: 'ready',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    store.deleteWorkspaceChat(chat.id);

    expect(store.listWorkspaceSources(chat.id)).toEqual([]);
  });

  it('keeps the chat and its sources when cascading deletion fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '자료를 지워줘' }] });
    store.insertWorkspaceSource({
      id: 'src_failed_delete_test',
      sessionId: chat.id,
      artifactId: 'art_failed_delete_test',
      fileName: 'keep.pdf',
      status: 'ready',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    db.exec(`
      CREATE TRIGGER reject_workspace_source_delete
      BEFORE DELETE ON workspace_chat_sources
      BEGIN
        SELECT RAISE(ABORT, 'source_delete_rejected');
      END
    `);

    expect(() => store.deleteWorkspaceChat(chat.id)).toThrow(/source_delete_rejected/);

    expect(store.getWorkspaceChat(chat.id)).not.toBeNull();
    expect(store.listWorkspaceSources(chat.id)).toHaveLength(1);
  });
});

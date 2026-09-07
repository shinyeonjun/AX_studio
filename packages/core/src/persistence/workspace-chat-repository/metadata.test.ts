import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace chat source metadata', () => {
  it('derives chat title from attached sources when there are no user messages', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    store.insertWorkspaceSource({
      id: 'src_title_one',
      sessionId: chat.id,
      artifactId: 'art_title_one',
      fileName: 'report.pdf',
      status: 'ready',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(store.refreshWorkspaceChatTitle(chat.id)).toBe('report.pdf');
    expect(store.getWorkspaceChat(chat.id)?.title).toBe('report.pdf');
    expect(store.listWorkspaceChats()[0]).toMatchObject({ sourceCount: 1 });
  });

  it('uses a multi-source title when several PDFs are attached without messages', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const now = '2026-08-24T00:00:00.000Z';
    for (const [index, fileName] of ['first.pdf', 'second.pdf', 'third.pdf'].entries()) {
      store.insertWorkspaceSource({
        id: `src_title_${index}`,
        sessionId: chat.id,
        artifactId: `art_title_${index}`,
        fileName,
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });
    }

    expect(store.refreshWorkspaceChatTitle(chat.id)).toBe('first.pdf 외 2개');
    expect(store.listWorkspaceChats()[0]).toMatchObject({ sourceCount: 3 });
  });
});

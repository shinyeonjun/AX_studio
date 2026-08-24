import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace source repository', () => {
  it('keeps source rows scoped to their workspace chat', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const first = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '첫 대화' }] });
    const second = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '둘째 대화' }] });
    const source = store.insertWorkspaceSource({
      id: 'src_first',
      sessionId: first.id,
      artifactId: 'art_pdf',
      fileName: 'report.pdf',
      status: 'processing',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(store.listWorkspaceSources(first.id)).toEqual([source]);
    expect(store.listWorkspaceSources(second.id)).toEqual([]);
    expect(store.getWorkspaceSource(second.id, source.id)).toBeNull();

    expect(store.updateWorkspaceSource(source.id, {
      status: 'ready',
      engine: 'docling',
      summary: {
        pageCount: 1,
        chunkCount: 1,
        tableCount: 0,
        imageCount: 0,
        visualPageCount: 0,
        visualPages: [],
        engine: 'docling',
      },
    })).toMatchObject({ status: 'ready', engine: 'docling' });
    expect(store.getWorkspaceSource(first.id, source.id)).toMatchObject({
      status: 'ready',
      summary: { pageCount: 1, engine: 'docling' },
    });
  });
});

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import { ArtifactStore } from './artifact-store.js';
import { WorkflowStore } from './workflow-store.js';
import { WorkspaceSourceError, WorkspaceSourceService } from './workspace-source-service.js';
import { MockDocumentEngineClient, setDocumentEngineClient } from '../document-engine/engine-client.js';

function mockEngine(text = '운영 서버 이전 일정이 확정되었습니다.') {
  const client = new MockDocumentEngineClient();
  client.ingest = async () => ({
    documentId: 'doc_session_fixture',
    artifactPath: '/private/engine-output/doc_session_fixture',
    engine: 'docling',
    text,
    summary: {
      pageCount: 2,
      chunkCount: 3,
      tableCount: 1,
      imageCount: 1,
      visualPageCount: 1,
      visualPages: [1],
      ocrPageCount: 1,
      ocrPages: [1],
      engine: 'docling',
    },
    pages: [
      { index: 0, text },
      { index: 1, text: '근거 페이지', hasVisual: true, ocrApplied: true },
    ],
    images: [{ id: 'img_1', pageIndex: 1, path: '/private/image.png', ocrText: '차트' }],
    tables: [{ id: 'table_1', pageIndex: 0, text: '항목 | 값' }],
  });
  return client;
}

describe('WorkspaceSourceService', () => {
  afterEach(() => setDocumentEngineClient(null));

  it('attaches a PDF, persists Docling metadata, and reads only bounded public data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-workspace-source-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '문서를 분석해줘' }] });
    const sourceDir = join(root, 'sessions');
    const artifacts = new ArtifactStore(join(root, 'artifacts'));
    const service = new WorkspaceSourceService(store, artifacts, sourceDir);
    setDocumentEngineClient(mockEngine('운영 서버 '.repeat(400)));
    const pdfPath = join(root, 'report.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 fixture');

    const source = await service.attachFile(chat.id, pdfPath, 'application/pdf');

    expect(source).toMatchObject({
      status: 'ready',
      fileName: 'report.pdf',
      engine: 'docling',
      summary: { pageCount: 2, tableCount: 1, visualPages: [1] },
    });
    expect(JSON.stringify(source)).not.toContain(root);
    expect(existsSync(join(sourceDir, chat.id, 'sources', source.id, 'manifest.json'))).toBe(true);
    expect(existsSync(join(sourceDir, chat.id, 'sources', source.id, 'docling.json'))).toBe(true);

    const read = service.read(chat.id, source.id, 1_000);
    expect(read.document.text).toContain('운영 서버');
    expect(JSON.stringify(read)).not.toContain(root);
    expect(JSON.stringify(read)).not.toContain('artifactPath');
    expect(JSON.stringify(read)).not.toContain('/private/');
    const contentLength = [
      read.document.text ?? '',
      ...read.document.pages.flatMap((page) => page.text ? [page.text] : []),
      ...read.document.images.flatMap((image) => image.ocrText ? [image.ocrText] : []),
      ...read.document.tables.flatMap((table) => table.text ? [table.text] : []),
    ].reduce((total, text) => total + text.length, 0);
    expect(contentLength).toBeLessThanOrEqual(1_000);

    const otherChat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '다른 대화' }] });
    expect(() => service.read(otherChat.id, source.id)).toThrowError(
      expect.objectContaining({ code: 'workspace_source_not_found' }),
    );
  });

  it('persists a failed ingest instead of exposing a ready source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-workspace-source-failed-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '실패 문서' }] });
    const service = new WorkspaceSourceService(
      store,
      new ArtifactStore(join(root, 'artifacts')),
      join(root, 'sessions'),
    );
    const client = mockEngine();
    client.ingest = async () => { throw new Error('document_engine_timeout'); };
    setDocumentEngineClient(client);
    const pdfPath = join(root, 'failed.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 fixture');

    const source = await service.attachFile(chat.id, pdfPath);

    expect(source).toMatchObject({ status: 'failed', errorCode: 'document_engine_timeout' });
    expect(() => service.read(chat.id, source.id)).toThrowError(WorkspaceSourceError);
    expect(store.listWorkspaceSources(chat.id)).toMatchObject([
      { status: 'failed', errorCode: 'document_engine_timeout' },
    ]);

    service.removeSession(chat.id);
    expect(existsSync(join(root, 'sessions', chat.id))).toBe(false);
  });
});

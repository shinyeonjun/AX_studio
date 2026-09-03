import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { ArtifactStore } from '../artifact-store.js';
import { WorkflowStore } from '../workflow-store.js';
import { WorkspaceSourceService } from '../workspace-source-service.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { mockEngine } from './fixtures.js';

describe('WorkspaceSourceService ingest and read', () => {
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

    const registered = await service.attachFile(chat.id, pdfPath, 'application/pdf');

    expect(registered).toMatchObject({ status: 'processing', fileName: 'report.pdf' });
    await service.waitForIdle();
    const source = service.list(chat.id)[0]!;

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
});

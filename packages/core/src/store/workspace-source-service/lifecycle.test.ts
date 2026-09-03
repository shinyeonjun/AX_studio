import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { ArtifactStore } from '../artifact-store.js';
import { WorkflowStore } from '../workflow-store.js';
import { WorkspaceSourceError, WorkspaceSourceService } from '../workspace-source-service.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { mockEngine } from './fixtures.js';

describe('WorkspaceSourceService ingest lifecycle', () => {
  afterEach(() => setDocumentEngineClient(null));

  it('keeps a source readable only after the independent ingest job is ready', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-workspace-source-lifecycle-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '자료 상태' }] });
    const artifacts = new ArtifactStore(join(root, 'artifacts'));
    const service = new WorkspaceSourceService(store, artifacts, join(root, 'sessions'));
    const client = mockEngine('분리된 문서 엔진 결과');
    const originalIngest = client.ingest.bind(client);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    client.ingest = async (path, options) => {
      await gate;
      return originalIngest(path, options);
    };
    setDocumentEngineClient(client);
    const changes: Array<{ sessionId: string; sourceId: string; status: string }> = [];
    service.subscribe((source) => changes.push({
      sessionId: source.sessionId,
      sourceId: source.id,
      status: source.status,
    }));
    const pdfPath = join(root, 'lifecycle.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 fixture');

    const registered = await service.attachFile(chat.id, pdfPath, 'application/pdf');

    expect(registered.status).toBe('processing');
    expect(() => service.read(chat.id, registered.id)).toThrowError(
      expect.objectContaining({ code: 'workspace_source_processing' }),
    );
    expect(changes).toContainEqual({ sessionId: chat.id, sourceId: registered.id, status: 'processing' });

    release();
    await service.waitForIdle();

    expect(service.list(chat.id)[0]).toMatchObject({ status: 'ready', engine: 'docling' });
    expect(changes).toEqual([
      { sessionId: chat.id, sourceId: registered.id, status: 'processing' },
      { sessionId: chat.id, sourceId: registered.id, status: 'ready' },
    ]);
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

    const registered = await service.attachFile(chat.id, pdfPath);
    expect(registered.status).toBe('processing');
    await service.waitForIdle();
    const source = service.list(chat.id)[0]!;

    expect(source).toMatchObject({ status: 'failed', errorCode: 'document_engine_timeout' });
    expect(() => service.read(chat.id, source.id)).toThrowError(WorkspaceSourceError);
    expect(store.listWorkspaceSources(chat.id)).toMatchObject([
      { status: 'failed', errorCode: 'document_engine_timeout' },
    ]);

    service.removeSession(chat.id);
    expect(existsSync(join(root, 'sessions', chat.id))).toBe(false);
  });
});

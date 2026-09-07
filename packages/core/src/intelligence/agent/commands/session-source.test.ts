import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { ArtifactStore } from '../../../persistence/artifact-store.js';
import { WorkspaceSourceService } from '../../../persistence/workspace-source-service.js';
import { MockDocumentEngineClient, setDocumentEngineClient } from '../../../documents/read/engine-client.js';
import { AGENT_COMMAND_CONTEXT } from './access.js';
import { AxCommandService } from './service.js';

describe('session source commands', () => {
  afterEach(() => setDocumentEngineClient(null));

  it('can page and filter all session sources without sending page metadata to the model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-pages-'));
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const chat = store.saveWorkspaceChat({ messages: [] });
      const otherChat = store.saveWorkspaceChat({ messages: [] });
      const sources = new WorkspaceSourceService(store, new ArtifactStore(join(root, 'artifacts')), join(root, 'sessions'));
      await sources.waitForIdle();
      for (let i = 0; i < 57; i++) store.insertWorkspaceSource({
        id: `source-${i}`, sessionId: chat.id, artifactId: `artifact-${i}`,
        fileName: `reference-${i}.pdf`, status: 'ready',
        createdAt: '2031-01-01', updatedAt: '2031-01-01',
        summary: { pageCount: 500, chunkCount: 0, tableCount: 0, imageCount: 0,
          visualPageCount: 500, visualPages: Array.from({ length: 500 }, (_, p) => p), engine: 'docling' },
      });
      const commands = new AxCommandService(store, { workspaceSources: sources });
      const options = { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id };
      const ids = new Set<string>();
      for (let offset = 0; offset < 57; offset += 20) {
        const result = await commands.execute({ name: 'session.source.list', args: { offset, limit: 20 } }, options);
        expect(result.status).toBe('ok');
        const page = result.data as { sources: Array<{ id: string }>; total: number };
        expect(page.total).toBe(57);
        expect(page.sources.length).toBeLessThanOrEqual(20);
        page.sources.forEach(source => ids.add(source.id));
        expect(JSON.stringify(page).includes('visualPages')).toBe(false);
        expect(JSON.stringify(page).length).toBeLessThan(6_000);
      }
      expect(ids.size).toBe(57);
      expect(await commands.execute({ name: 'session.source.list', args: { query: 'reference-56.pdf' } }, options))
        .toMatchObject({ data: { total: 1, sources: [{ id: 'source-56' }] } });
      expect(await commands.execute({ name: 'session.source.list' }, { ...options, workspaceSessionId: otherChat.id }))
        .toMatchObject({ data: { total: 0, sources: [] } });
    } finally {
      db.close?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists and reads only the current workspace session source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-session-command-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '자료' }] });
    const otherChat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '다른 자료' }] });
    const engine = new MockDocumentEngineClient();
    engine.ingest = async () => ({
      documentId: 'doc_command_fixture',
      artifactPath: 'D:/private/docling/doc_command_fixture',
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
      text: '세션 command 근거',
      pages: [{ index: 0, text: '세션 command 근거' }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalIngest = engine.ingest.bind(engine);
    engine.ingest = async (path, options) => {
      await gate;
      return originalIngest(path, options);
    };
    setDocumentEngineClient(engine);
    const sourceService = new WorkspaceSourceService(
      store,
      new ArtifactStore(join(root, 'artifacts')),
      join(root, 'sessions'),
    );
    const pdfPath = join(root, 'command.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 fixture');
    const registered = await sourceService.attachFile(chat.id, pdfPath);
    expect(registered.status).toBe('processing');
    const commands = new AxCommandService(store, { workspaceSources: sourceService });
    const pendingRead = await commands.execute(
      { name: 'session.source.read', args: { sourceId: registered.id } },
      { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id },
    );
    expect(pendingRead).toMatchObject({
      status: 'needs_input',
      issues: [{ code: 'workspace_source_processing' }],
    });
    release();
    await sourceService.waitForIdle();
    const source = sourceService.list(chat.id)[0]!;

    const listed = await commands.execute(
      { name: 'session.source.list' },
      { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id },
    );
    expect(listed).toMatchObject({ status: 'ok', data: { sources: [{ id: source.id, status: 'ready' }] } });

    const read = await commands.execute(
      { name: 'session.source.read', args: { sourceId: source.id } },
      { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id },
    );
    expect(read).toMatchObject({ status: 'ok', data: { document: { text: '세션 command 근거' } } });
    expect(JSON.stringify(read)).not.toContain('D:/private');

    const isolated = await commands.execute(
      { name: 'session.source.read', args: { sourceId: source.id } },
      { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: otherChat.id },
    );
    expect(isolated).toMatchObject({ status: 'not_found', issues: [{ code: 'workspace_source_not_found' }] });
  });
});

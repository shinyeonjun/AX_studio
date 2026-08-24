import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { ArtifactStore } from '../../store/artifact-store.js';
import { WorkspaceSourceService } from '../../store/workspace-source-service.js';
import { MockDocumentEngineClient, setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { AGENT_COMMAND_CONTEXT } from './access.js';
import { AxCommandService } from './service.js';

describe('session source commands', () => {
  afterEach(() => setDocumentEngineClient(null));

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
    setDocumentEngineClient(engine);
    const sourceService = new WorkspaceSourceService(
      store,
      new ArtifactStore(join(root, 'artifacts')),
      join(root, 'sessions'),
    );
    const pdfPath = join(root, 'command.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 fixture');
    const source = await sourceService.attachFile(chat.id, pdfPath);
    const commands = new AxCommandService(store, { workspaceSources: sourceService });

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

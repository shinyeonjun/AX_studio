import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { setDocumentEngineClient } from '../document-engine/engine-client.js';
import type { IngestDocumentResult } from '../document-engine/types.js';
import { buildDesignToolContext, executeDesignTool, executeDesignToolCalls, formatDesignToolResults } from './index.js';

describe('design-tools', () => {
  it('lists connections and local folder files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');

    const ctx = buildDesignToolContext(
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [{ id: 'folder-1', label: 'Inbox', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        },
        { connector: 'slack', connected: true, config: { token: 'xoxb-test' } },
      ],
      ['slack', 'local_folder', 'document'],
    );

    const results = await executeDesignToolCalls(
      [
        { tool: 'connections.list' },
        { tool: 'sources.list', args: { connector: 'local_folder' } },
        { tool: 'sources.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } },
      ],
      ctx,
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(JSON.stringify(results[0]?.data)).toContain('local_folder');
    expect(JSON.stringify(results[2]?.data)).toContain('report.pdf');
  });

  it('lists available design tools via tools.list', async () => {
    const ctx = buildDesignToolContext([], ['document']);
    const results = await executeDesignToolCalls([{ tool: 'tools.list' }], ctx);

    expect(results[0]?.ok).toBe(true);
    const tools = results[0]?.data as Array<{ id: string }>;
    expect(tools.map((entry) => entry.id)).toEqual([
      'tools.list',
      'connections.list',
      'sources.list',
      'sources.files.list',
      'sources.file.read',
      'sources.search',
      'capabilities.list',
      'capabilities.describe',
      'capabilities.invoke',
      'workflow.inspect',
      'workflows.list',
      'workflows.run',
    ]);
  });

  it('reads only a bounded PDF excerpt inside the connected folder root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-read-'));
    const pdfPath = join(dir, 'report.pdf');
    writeFileSync(pdfPath, 'pdf');
    const outsideDir = mkdtempSync(join(tmpdir(), 'ax-design-outside-'));
    const outsidePath = join(outsideDir, 'outside.pdf');
    writeFileSync(outsidePath, 'outside');
    const result: IngestDocumentResult = {
      documentId: 'doc-1',
      artifactPath: '/artifacts/doc-1',
      engine: 'test',
      summary: {
        pageCount: 1,
        chunkCount: 1,
        tableCount: 0,
        imageCount: 0,
        visualPageCount: 0,
        visualPages: [],
        engine: 'test',
      },
      text: 'A'.repeat(20_000),
    };
    setDocumentEngineClient({
      ping: async () => true,
      ingest: async () => result,
      pdfToHtml: async () => { throw new Error('unused'); },
      getChunk: async () => { throw new Error('unused'); },
      getPage: async () => { throw new Error('unused'); },
      search: async () => { throw new Error('unused'); },
    });
    try {
      const localReadContext = buildDesignToolContext([
        {
          connector: 'local_folder',
          connected: true,
          config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] },
        },
      ], ['local_folder', 'document'], undefined, { allowUntrustedData: true });
      const [read] = await executeDesignToolCalls([
        { tool: 'sources.file.read', args: { folderId: 'folder-1', path: pdfPath, maxChars: 1_000 } },
      ], localReadContext);
      expect(read?.ok).toBe(true);
      expect((read?.data as { content: string; truncated: boolean }).content).toHaveLength(1_000);
      expect((read?.data as { truncated: boolean }).truncated).toBe(true);

      const [outside] = await executeDesignToolCalls([
        { tool: 'sources.file.read', args: { folderId: 'folder-1', path: outsidePath } },
      ], localReadContext);
      expect(outside?.ok).toBe(false);
      expect(outside?.error).toBe('path_outside_source');
    } finally {
      setDocumentEngineClient(null);
    }
  });

  it('blocks untrusted PDF body text when the caller has no local-data permission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-policy-'));
    const pdfPath = join(dir, 'report.pdf');
    writeFileSync(pdfPath, 'pdf');
    setDocumentEngineClient({
      ping: async () => true,
      ingest: async () => { throw new Error('must_not_ingest'); },
      pdfToHtml: async () => { throw new Error('unused'); },
      getChunk: async () => { throw new Error('unused'); },
      getPage: async () => { throw new Error('unused'); },
      search: async () => { throw new Error('unused'); },
    });
    try {
      const [read] = await executeDesignToolCalls([
        { tool: 'sources.file.read', args: { folderId: 'folder-1', path: pdfPath } },
      ], buildDesignToolContext([
        {
          connector: 'local_folder',
          connected: true,
          config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] },
        },
      ], ['local_folder']));
      expect(read?.ok).toBe(false);
      expect(read?.error).toBe('source_content_requires_local_ai');
    } finally {
      setDocumentEngineClient(null);
    }
  });

  it('does not read a configured folder after the connection is disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-disconnected-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');
    const ctx = buildDesignToolContext([
      {
        connector: 'local_folder',
        connected: false,
        config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] },
      },
    ], []);

    const [listed, read] = await executeDesignToolCalls(
      [
        { tool: 'sources.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } },
        { tool: 'sources.file.read', args: { folderId: 'folder-1', path: join(dir, 'report.pdf') } },
      ],
      ctx,
    );

    expect(listed?.ok).toBe(false);
    expect(listed?.error).toBe('local_folder_not_connected');
    expect(read?.ok).toBe(false);
    expect(read?.error).toBe('local_folder_not_connected');
  });

  it('describes capabilities for connected connectors', async () => {
    const ctx = buildDesignToolContext([], ['document', 'local_sheet']);
    const results = await executeDesignToolCalls(
      [
        { tool: 'capabilities.list', args: { connector: 'document' } },
        { tool: 'capabilities.describe', args: { id: 'document.ingest' } },
      ],
      ctx,
    );

    expect(results[0]?.ok).toBe(true);
    expect(JSON.stringify(results[0]?.data)).toContain('document.ingest');
    expect(results[1]?.ok).toBe(true);
    expect(JSON.stringify(results[1]?.data)).toContain('"available":true');
  });

  it('lists packaged actions before connector authentication', async () => {
    const results = await executeDesignToolCalls(
      [{ tool: 'capabilities.list', args: { kind: 'write' } }],
      buildDesignToolContext([], ['document']),
    );

    expect(results[0]?.ok).toBe(true);
    const data = results[0]?.data as { capabilities: Array<{ id: string; connection: string }> };
    expect(data.capabilities.some((cap) => cap.id === 'gmail.message.send' && cap.connection === 'required')).toBe(true);
    expect(data.capabilities.some((cap) => cap.id === 'slack.message.send' && cap.connection === 'required')).toBe(true);
  });

  it('bounds tool calls and returned tool context', async () => {
    await expect(
      executeDesignToolCalls(
        Array.from({ length: 6 }, () => ({ tool: 'connections.list' as const })),
        buildDesignToolContext([], []),
      ),
    ).rejects.toThrow('too_many_design_tool_calls:5');

    const formatted = formatDesignToolResults([
      { tool: 'sources.file.read', ok: true, data: 'x'.repeat(70_000) },
    ]);
    expect(formatted.length).toBeLessThan(60_100);
    expect(formatted).toContain('[design-tool results truncated]');
  });

  it('blocks workflow.inspect in plain chat', async () => {
    const result = await executeDesignTool(
      { tool: 'workflow.inspect' },
      buildDesignToolContext([], [], undefined, { interactionMode: 'plain_chat' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('tool_not_allowed_in_plain_chat');
  });

  it('rejects workflows.run for ids not returned by workflows.list', async () => {
    const result = await executeDesignTool(
      { tool: 'workflows.run', args: { workflowId: 'missing' } },
      buildDesignToolContext([], [], undefined, {
        interactionMode: 'plain_chat',
        workflowActions: {
          list: () => [{ id: 'known', name: 'Known', active: false }],
          run: async () => ({ executionId: 'x', status: 'success' }),
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Workflow not found');
  });
});

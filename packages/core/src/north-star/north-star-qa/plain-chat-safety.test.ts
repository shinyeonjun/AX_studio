/**
 * North Star product QA — plain-chat data and action policy.
 * See docs/qa/north-star-scenarios.md
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { clearDynamicCatalogForTests } from '../../catalog/dynamic-catalog.js';
import { buildDesignToolContext, executeDesignTool } from '../../design-tools/index.js';
import { MockSlackConnector } from '../../modules/mocks/slack.js';
import { applySnippetPolicy, MAX_CLOUD_SNIPPET_CHARS } from '../../retrieval/snippet-policy.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';

describe('North Star QA plain-chat safety', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
    setDocumentEngineClient(null);
  });

  it('reads Slack via capabilities.invoke with citations', async () => {
    const slack = new MockSlackConnector();
    const ctx = buildDesignToolContext([{ connector: 'slack', connected: true }], ['slack'], {
      allowUntrustedData: true,
      connectors: { slack },
    });
    const result = await executeDesignTool(
      { tool: 'capabilities.invoke', args: { id: 'slack.messages.search', params: { query: 'deploy' } } },
      ctx,
    );
    expect(result.ok).toBe(true);
    const envelope = result.data as { citations: unknown[] };
    expect(envelope.citations.length).toBeGreaterThan(0);
  });

  it('blocks Slack send in plain chat', async () => {
    const slack = new MockSlackConnector();
    const ctx = buildDesignToolContext([{ connector: 'slack', connected: true }], ['slack'], {
      connectors: { slack },
    });
    const result = await executeDesignTool(
      { tool: 'capabilities.invoke', args: { id: 'slack.message.send', params: { channel: '#x', text: 'x' } } },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it('blocks PDF body for cloud callers without local-data consent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-qa-pdf-'));
    const pdfPath = join(dir, 'doc.pdf');
    writeFileSync(pdfPath, 'pdf');
    setDocumentEngineClient({
      ping: async () => true,
      ingest: async () => ({
        documentId: 'd1',
        artifactPath: '/a',
        engine: 'test',
        summary: { pageCount: 1, chunkCount: 1, tableCount: 0, imageCount: 0, visualPageCount: 0, visualPages: [], engine: 'test' },
        text: 'secret-pdf-body',
      }),
      pdfToHtml: async () => { throw new Error('unused'); },
      getChunk: async () => { throw new Error('unused'); },
      getPage: async () => { throw new Error('unused'); },
      search: async () => { throw new Error('unused'); },
    });
    const ctx = buildDesignToolContext(
      [{ connector: 'local_folder', connected: true, config: { folders: [{ id: 'f1', label: 'Inbox', path: dir }] } }],
      ['local_folder'],
      { allowUntrustedData: false },
    );
    const result = await executeDesignTool(
      { tool: 'sources.file.read', args: { folderId: 'f1', path: pdfPath } },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('source_content_requires_local_ai');
  });

  it('caps search snippets for cloud callers', () => {
    const capped = applySnippetPolicy(
      [{ ref: { connector: 'local_folder', kind: 'file', id: 'f:1' }, score: 1, snippet: 'x'.repeat(400) }],
      { allowFullContent: false },
    );
    expect(capped[0]?.snippet?.length).toBe(MAX_CLOUD_SNIPPET_CHARS);
  });
});

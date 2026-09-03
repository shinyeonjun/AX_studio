import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import type { IngestDocumentResult } from '../../document-engine/types.js';
import { buildDesignToolContext, executeDesignToolCalls } from '../index.js';
describe('design-tools bounded source read', () => {
  it('reads only a bounded PDF excerpt inside the connected folder root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-read-'));
    const pdfPath = join(dir, 'report.pdf');
    writeFileSync(pdfPath, 'pdf');
    const outsideDir = mkdtempSync(join(tmpdir(), 'ax-design-outside-'));
    const outsidePath = join(outsideDir, 'outside.pdf');
    writeFileSync(outsidePath, 'outside');
    const result: IngestDocumentResult = {
      documentId: 'doc-1', artifactPath: '/artifacts/doc-1', engine: 'test',
      summary: { pageCount: 1, chunkCount: 1, tableCount: 0, imageCount: 0, visualPageCount: 0, visualPages: [], engine: 'test' },
      text: 'A'.repeat(20_000),
    };
    setDocumentEngineClient({ ping: async () => true, ingest: async () => result, pdfToHtml: async () => { throw new Error('unused'); }, getChunk: async () => { throw new Error('unused'); }, getPage: async () => { throw new Error('unused'); }, search: async () => { throw new Error('unused'); } });
    try {
      const localReadContext = buildDesignToolContext([{ connector: 'local_folder', connected: true, config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] } }], ['local_folder', 'document'], { allowUntrustedData: true });
      const [read] = await executeDesignToolCalls([{ tool: 'sources.file.read', args: { folderId: 'folder-1', path: pdfPath, maxChars: 1_000 } }], localReadContext);
      expect(read?.ok).toBe(true);
      expect((read?.data as { content: string; truncated: boolean }).content).toHaveLength(1_000);
      expect((read?.data as { truncated: boolean }).truncated).toBe(true);
      const [outside] = await executeDesignToolCalls([{ tool: 'sources.file.read', args: { folderId: 'folder-1', path: outsidePath } }], localReadContext);
      expect(outside?.ok).toBe(false);
      expect(outside?.error).toBe('path_outside_source');
    } finally {
      setDocumentEngineClient(null);
    }
  });
});

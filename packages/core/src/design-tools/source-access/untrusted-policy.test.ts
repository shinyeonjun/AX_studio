import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { buildDesignToolContext, executeDesignToolCalls } from '../index.js';
describe('design-tools untrusted source policy', () => {
  it('blocks untrusted PDF body text when the caller has no local-data permission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-policy-'));
    const pdfPath = join(dir, 'report.pdf');
    writeFileSync(pdfPath, 'pdf');
    setDocumentEngineClient({ ping: async () => true, ingest: async () => { throw new Error('must_not_ingest'); }, pdfToHtml: async () => { throw new Error('unused'); }, getChunk: async () => { throw new Error('unused'); }, getPage: async () => { throw new Error('unused'); }, search: async () => { throw new Error('unused'); } });
    try {
      const [read] = await executeDesignToolCalls([{ tool: 'sources.file.read', args: { folderId: 'folder-1', path: pdfPath } }], buildDesignToolContext([{ connector: 'local_folder', connected: true, config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] } }], ['local_folder']));
      expect(read?.ok).toBe(false);
      expect(read?.error).toBe('source_content_requires_local_ai');
    } finally {
      setDocumentEngineClient(null);
    }
  });
});

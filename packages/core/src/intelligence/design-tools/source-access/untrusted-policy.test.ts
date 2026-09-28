import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { MockDocumentEngineClient, setDocumentEngineClient } from '../../../documents/read/engine-client.js';
import { buildDesignToolContext, executeDesignToolCalls } from '../index.js';
describe('design-tools untrusted source policy', () => {
  it('blocks untrusted PDF body text when the caller has no local-data permission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-policy-'));
    const pdfPath = join(dir, 'report.pdf');
    writeFileSync(pdfPath, 'pdf');
    const client = new MockDocumentEngineClient();
    const ingest = vi.spyOn(client, 'ingest').mockRejectedValue(new Error('must_not_ingest'));
    setDocumentEngineClient(client);
    try {
      const [read] = await executeDesignToolCalls([{ tool: 'sources.file.read', args: { folderId: 'folder-1', path: pdfPath } }], buildDesignToolContext([{ connector: 'local_folder', connected: true, config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] } }], ['local_folder']));
      expect(read?.ok).toBe(false);
      expect(read?.error).toBe('source_content_requires_local_ai');
      expect(ingest).not.toHaveBeenCalled();
    } finally {
      setDocumentEngineClient(null);
    }
  });
});

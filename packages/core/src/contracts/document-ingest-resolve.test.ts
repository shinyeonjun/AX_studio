import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveDocumentIngestExecution } from './document-ingest-resolve.js';

describe('resolveDocumentIngestExecution', () => {
  it('rejects a physical path when no connected local folder exists', () => {
    const resolved = resolveDocumentIngestExecution(
      { path: 'C:/outside/report.pdf' },
      { variables: {}, connections: [] },
    );

    expect(resolved).toEqual({
      ok: false,
      error: 'local_folder_not_connected',
      errorCode: 'local_folder_not_connected',
    });
  });

  it('falls back to connected folder file when ingest path is outside the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-ingest-'));
    const pdfPath = join(root, 'report.pdf');
    writeFileSync(pdfPath, 'pdf');

    const connections = [
      {
        connector: 'local_folder',
        connected: true,
        config: {
          folders: [{ id: 'folder-1', label: 'Inbox', path: root, addedAt: new Date().toISOString() }],
        },
      },
    ];

    const resolved = resolveDocumentIngestExecution(
      { path: join(tmpdir(), 'invented.pdf') },
      {
        variables: { filePath: pdfPath, fileName: 'report.pdf', folderId: 'folder-1', folderPath: root },
        connections,
      },
    );

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.params.path).toBe(pdfPath);
    }
  });
});

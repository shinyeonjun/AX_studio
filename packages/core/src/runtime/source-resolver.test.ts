import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveFileRef, resolveIngestPath } from './source-resolver.js';

describe('source resolver', () => {
  it('resolves FileRef inside a connected folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-'));
    const filePath = join(root, 'sample.pdf');
    writeFileSync(filePath, 'pdf');

    const connections = [
      {
        connector: 'local_folder',
        connected: true,
        config: {
          folders: [{ id: 'folder-1', label: 'Inbox', path: root, addedAt: new Date().toISOString() }],
        },
      },
    ];

    const resolved = resolveFileRef(
      {
        sourceId: 'folder-1',
        folderId: 'folder-1',
        path: filePath,
        name: 'sample.pdf',
      },
      connections,
    );

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.path).toContain('sample.pdf');
    }
  });

  it('rejects paths outside connected folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-outside-'));
    const filePath = join(outside, 'secret.pdf');
    writeFileSync(filePath, 'pdf');

    const connections = [
      {
        connector: 'local_folder',
        connected: true,
        config: {
          folders: [{ id: 'folder-1', label: 'Inbox', path: root, addedAt: new Date().toISOString() }],
        },
      },
    ];

    const resolved = resolveIngestPath({ path: filePath }, connections);
    expect(resolved.ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveFileRef } from '../source-resolver.js';

describe('source resolver connected FileRef', () => {
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
});

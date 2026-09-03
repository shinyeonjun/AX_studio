import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveIngestPath } from '../source-resolver.js';

describe('source resolver path boundaries', () => {
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
    if (!resolved.ok) {
      expect(resolved.errorCode).toBe('path_outside_source');
    }
  });

  it('preserves path_outside_source when another configured folder is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-outside-'));
    const filePath = join(outside, 'secret.pdf');
    writeFileSync(filePath, 'pdf');

    const resolved = resolveIngestPath(
      { path: filePath },
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [
              { id: 'missing', label: 'Missing', path: join(root, 'gone'), addedAt: new Date().toISOString() },
              { id: 'folder-1', label: 'Inbox', path: root, addedAt: new Date().toISOString() },
            ],
          },
        },
      ],
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.errorCode).toBe('path_outside_source');
  });
});

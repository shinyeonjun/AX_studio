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
    if (!resolved.ok) {
      expect(resolved.errorCode).toBe('path_outside_source');
    }
  });

  it('reports missing files instead of path_outside_source', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-'));
    const connections = [
      {
        connector: 'local_folder',
        connected: true,
        config: {
          folders: [{ id: 'folder-1', label: 'Inbox', path: root, addedAt: new Date().toISOString() }],
        },
      },
    ];

    const resolved = resolveIngestPath({ path: join(root, 'missing.pdf') }, connections);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.errorCode).toBe('file_not_accessible');
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

  it('preserves file_not_accessible for a missing path inside one of several roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-outside-'));
    const missingPath = join(root, 'missing.pdf');

    const resolved = resolveIngestPath(
      { path: missingPath },
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [
              { id: 'folder-1', label: 'Inbox', path: root, addedAt: new Date().toISOString() },
              { id: 'folder-2', label: 'Other', path: outside, addedAt: new Date().toISOString() },
            ],
          },
        },
      ],
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.errorCode).toBe('file_not_accessible');
  });
});

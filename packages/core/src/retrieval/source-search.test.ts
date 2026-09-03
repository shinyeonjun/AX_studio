import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignToolCalls } from '../design-tools/index.js';
import { clearRetrievalStoreForTests } from './index.js';

describe('sources.search retrieval gateway', () => {
  afterEach(() => {
    clearRetrievalStoreForTests();
  });

  it('sources.search falls back when index is disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-retrieval-off-'));
    writeFileSync(join(dir, 'notes.txt'), 'x'.repeat(20_000));

    const ctx = buildDesignToolContext(
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [{ id: 'folder-1', label: 'Docs', path: dir }],
            retrievalIndex: { enabled: false },
          },
        },
      ],
      ['local_folder'],
    );

    const [result] = await executeDesignToolCalls(
      [{ tool: 'sources.search', args: { folderId: 'folder-1', query: 'notes' } }],
      ctx,
    );
    expect(result?.ok).toBe(true);
    expect((result?.data as { indexEnabled: boolean; fallback: string }).indexEnabled).toBe(false);
    expect((result?.data as { fallback: string }).fallback).toBe('sources.files.list');
  });

  it('sources.search returns citations when index is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-retrieval-on-'));
    writeFileSync(join(dir, 'policy.txt'), `${'p'.repeat(20_000)}\nretention policy details\n`);

    const ctx = buildDesignToolContext(
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [{ id: 'folder-1', label: 'Docs', path: dir }],
            retrievalIndex: { enabled: true, minFileBytes: 0 },
          },
        },
      ],
      ['local_folder'],
      { allowUntrustedData: false },
    );

    const [result] = await executeDesignToolCalls(
      [{ tool: 'sources.search', args: { folderId: 'folder-1', query: 'retention policy' } }],
      ctx,
    );
    expect(result?.ok).toBe(true);
    const data = result?.data as { indexEnabled: boolean; hits: unknown[]; citations: unknown[] };
    expect(data.indexEnabled).toBe(true);
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.citations.length).toBeGreaterThan(0);
  });
});

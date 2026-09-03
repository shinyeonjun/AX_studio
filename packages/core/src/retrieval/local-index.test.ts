import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRetrievalStoreForTests,
  searchLocalFolder,
  applySnippetPolicy,
  MAX_CLOUD_SNIPPET_CHARS,
} from './index.js';

describe('local retrieval index', () => {
  afterEach(() => {
    clearRetrievalStoreForTests();
  });

  it('returns only ACL-contained files and ranks by query', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-retrieval-'));
    const inside = join(dir, 'deploy-notes.txt');
    const big = 'x'.repeat(20_000);
    writeFileSync(inside, `${big}\nproduction deploy checklist\n`);
    writeFileSync(join(dir, 'readme.txt'), `${big}\nunrelated content only\n`);

    const folder = { id: 'folder-1', label: 'Docs', path: dir, addedAt: '2026-01-01T00:00:00.000Z' };
    const hits = searchLocalFolder(folder, 'deploy checklist', { minFileBytes: 0, rebuild: true });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.ref.path).toBe(inside);
    expect(hits[0]?.snippet).toContain('deploy');
  });

  it('drops deleted files from search results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-retrieval-stale-'));
    const target = join(dir, 'volatile.txt');
    const padding = 'z'.repeat(20_000);
    writeFileSync(target, `${padding}\nunique-token-alpha\n`);

    const folder = { id: 'folder-1', label: 'Docs', path: dir, addedAt: '2026-01-01T00:00:00.000Z' };
    const first = searchLocalFolder(folder, 'unique-token-alpha', { minFileBytes: 0, rebuild: true });
    expect(first).toHaveLength(1);

    unlinkSync(target);
    const second = searchLocalFolder(folder, 'unique-token-alpha', { minFileBytes: 0 });
    expect(second).toHaveLength(0);
  });

  it('caps snippets for cloud callers', () => {
    const longSnippet = 'a'.repeat(500);
    const capped = applySnippetPolicy(
      [{ ref: { connector: 'local_folder', kind: 'file', id: 'f:1' }, score: 1, snippet: longSnippet }],
      { allowFullContent: false },
    );
    expect(capped[0]?.snippet).toHaveLength(MAX_CLOUD_SNIPPET_CHARS);
  });
});

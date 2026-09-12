import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applySnippetPolicy,
  MAX_CLOUD_SNIPPET_CHARS,
} from './snippet-policy.js';
import { searchLocalFolder } from './search.js';

describe('local retrieval index', () => {
  const roots: string[] = [];
  const temporaryFolder = (prefix: string) => {
    const path = mkdtempSync(join(tmpdir(), prefix));
    roots.push(path);
    return path;
  };
  afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

  it('keeps only the highest-scored hits and handles invalid limits without retaining all rows', () => {
    const dir = temporaryFolder('ax-retrieval-top-');
    writeFileSync(join(dir, 'a.txt'), 'needle');
    writeFileSync(join(dir, 'b.txt'), 'needle match');
    writeFileSync(join(dir, 'c.txt'), 'needle match');
    const folder = { id: 'top', label: 'Docs', path: dir, addedAt: '2026-01-01' };
    expect(searchLocalFolder(folder, 'needle match', { limit: 1 }).map(hit => hit.score)).toEqual([1]);
    expect(searchLocalFolder(folder, 'needle match', { limit: NaN })).toEqual([]);
  });
  it('finds newly added and changed files on the next search', () => {
    const dir = temporaryFolder('ax-retrieval-refresh-');
    const folder = { id: 'refresh', label: 'Docs', path: dir, addedAt: '2026-01-01' };
    writeFileSync(join(dir, 'old.txt'), 'needle old');
    expect(searchLocalFolder(folder, 'needle')).toHaveLength(1);
    writeFileSync(join(dir, 'new.txt'), 'needle new');
    writeFileSync(join(dir, 'old.txt'), 'needle updated document');
    expect(searchLocalFolder(folder, 'needle')).toHaveLength(2);
  });


  it('returns only ACL-contained files and ranks by query', () => {
    const dir = temporaryFolder('ax-retrieval-');
    const inside = join(dir, 'deploy-notes.txt');
    const big = 'x'.repeat(20_000);
    writeFileSync(inside, `${big}\nproduction deploy checklist\n`);
    writeFileSync(join(dir, 'readme.txt'), `${big}\nunrelated content only\n`);

    const folder = { id: 'folder-1', label: 'Docs', path: dir, addedAt: '2026-01-01T00:00:00.000Z' };
    const hits = searchLocalFolder(folder, 'deploy checklist', { minFileBytes: 0 });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.ref.path).toBe(inside);
    expect(hits[0]?.snippet).toContain('deploy');
  });

  it('drops deleted files from search results', () => {
    const dir = temporaryFolder('ax-retrieval-stale-');
    const target = join(dir, 'volatile.txt');
    const padding = 'z'.repeat(20_000);
    writeFileSync(target, `${padding}\nunique-token-alpha\n`);

    const folder = { id: 'folder-1', label: 'Docs', path: dir, addedAt: '2026-01-01T00:00:00.000Z' };
    const first = searchLocalFolder(folder, 'unique-token-alpha', { minFileBytes: 0 });
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

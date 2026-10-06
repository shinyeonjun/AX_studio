import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isPathContainedInRoot, resolveFileWithinFolderRoot } from './local-folder-path.js';

describe('isPathContainedInRoot', () => {
  const root = resolve('/data/root');

  it('accepts the root itself and its descendants', () => {
    expect(isPathContainedInRoot(root, root)).toBe(true);
    expect(isPathContainedInRoot(root, join(root, 'a', 'b.txt'))).toBe(true);
  });

  it('accepts children whose names merely start with two dots', () => {
    expect(isPathContainedInRoot(root, join(root, '..archive'))).toBe(true);
    expect(isPathContainedInRoot(root, join(root, '..archive', 'file.txt'))).toBe(true);
    expect(isPathContainedInRoot(root, join(root, '...'))).toBe(true);
  });

  it('rejects the parent, siblings and prefix look-alikes', () => {
    expect(isPathContainedInRoot(root, resolve('/data'))).toBe(false);
    expect(isPathContainedInRoot(root, resolve('/data/other/file.txt'))).toBe(false);
    expect(isPathContainedInRoot(root, resolve('/data/root-sibling/file.txt'))).toBe(false);
  });
});

describe('resolveFileWithinFolderRoot', () => {
  let directory: string | undefined;
  afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  it('resolves a file inside a `..archive` folder', () => {
    directory = mkdtempSync(join(tmpdir(), 'ax-folder-path-'));
    mkdirSync(join(directory, '..archive'));
    writeFileSync(join(directory, '..archive', 'report.txt'), 'x');

    const result = resolveFileWithinFolderRoot(directory, join('..archive', 'report.txt'));
    expect(result.ok).toBe(true);
    expect(resolveFileWithinFolderRoot(join(directory, '..archive'), join('..', '..archive', 'report.txt')).ok).toBe(true);
  });
});

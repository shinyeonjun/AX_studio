import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isPathContainedInRoot, resolveFileWithinFolderRoot } from './path-security.js';
import { scanFolder, scanFolderChecked, trimSeenFileKeys, MAX_FILES_PER_SCAN } from './scan.js';

describe('local folder path security', () => {
  it.skipIf(process.platform === 'win32')('keeps POSIX path comparisons case-sensitive', () => {
    expect(isPathContainedInRoot('/tmp/Connected', '/tmp/connected/secret.txt')).toBe(false);
  });

  it('rejects paths outside the connected folder root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-outside-'));
    const filePath = join(outside, 'secret.txt');
    writeFileSync(filePath, 'secret');

    const resolved = resolveFileWithinFolderRoot(root, filePath);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.errorCode).toBe('path_outside_source');
    }
  });

  it('accepts files inside the connected folder root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    const filePath = join(root, 'sample.txt');
    writeFileSync(filePath, 'hello');

    const resolved = resolveFileWithinFolderRoot(root, filePath);
    expect(resolved.ok).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('does not follow directory symlinks during scan', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-outside-'));
    const outsideFile = join(outside, 'outside.txt');
    writeFileSync(outsideFile, 'outside');
    symlinkSync(outside, join(root, 'linked'), 'dir');

    const files = scanFolder(root);
    expect(files.some((file) => file.fileName === 'outside.txt')).toBe(false);
    expect(isPathContainedInRoot(root, outside)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('rejects file symlinks that resolve outside the connected root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-outside-'));
    const outsideFile = join(outside, 'secret.txt');
    const linkedFile = join(root, 'linked.txt');
    writeFileSync(outsideFile, 'secret');
    symlinkSync(outsideFile, linkedFile, 'file');

    const resolved = resolveFileWithinFolderRoot(root, linkedFile);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.errorCode).toBe('path_outside_source');
    }
  });

  it('reports an inaccessible root instead of treating it as an empty folder', () => {
    const result = scanFolderChecked(join(tmpdir(), 'ax-folder-does-not-exist'));
    expect(result).toEqual({
      ok: false,
      error: 'folder_not_accessible',
      errorCode: 'folder_not_accessible',
    });
  });
});

describe('seen file keys', () => {
  it('keeps up to the scan limit', () => {
    const keys = Array.from({ length: MAX_FILES_PER_SCAN }, (_, index) => `file-${index}`);
    expect(trimSeenFileKeys(keys)).toHaveLength(MAX_FILES_PER_SCAN);
  });
});

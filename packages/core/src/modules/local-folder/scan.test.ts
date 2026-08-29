import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeExtensions, scanFolderChecked } from './scan.js';

describe('normalizeExtensions', () => {
  it('treats blank-only entries as no filter', () => {
    expect(normalizeExtensions(['', '   '])).toBeNull();
  });

  it('drops blank entries while normalizing valid extensions', () => {
    expect([...normalizeExtensions([' ', 'PDF'])!]).toEqual(['.pdf']);
  });
});

describe('scanFolderChecked', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  function createFolder(): string {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-scan-folder-'));
    tempDirs.push(folderPath);
    writeFileSync(join(folderPath, 'report.pdf'), 'report');
    writeFileSync(join(folderPath, 'notes.txt'), 'notes');
    return folderPath;
  }

  it('treats blank extension entries as no filter', () => {
    const result = scanFolderChecked(createFolder(), ['', '   ']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => file.fileName)).toEqual(['notes.txt', 'report.pdf']);
  });

  it('ignores blank entries alongside valid extensions', () => {
    const result = scanFolderChecked(createFolder(), [' ', 'PDF']);

    expect(result).toMatchObject({
      ok: true,
      files: [{ fileName: 'report.pdf', extension: '.pdf' }],
    });
  });
});

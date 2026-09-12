import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MAX_WORKBOOK_BYTES } from './profile.js';
import { readWorkbookFromPath } from './read/workbook.js';

describe('readWorkbookFromPath workbook identity', () => {
  it('preserves worksheet visibility metadata', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ax-sheet-read-')), 'visibility.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['visible']]), 'Visible');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['hidden']]), 'Hidden');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['very hidden']]), 'VeryHidden');
    workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }] };
    writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

    const result = readWorkbookFromPath(path);

    expect(result.workbook.sheets.map(({ name, visibility }) => ({ name, visibility }))).toEqual([
      { name: 'Visible', visibility: 'visible' },
      { name: 'Hidden', visibility: 'hidden' },
      { name: 'VeryHidden', visibility: 'veryHidden' },
    ]);
  });

  it('keeps CSV workbook and table ids stable for the same content', () => {
    const firstPath = join(mkdtempSync(join(tmpdir(), 'ax-sheet-read-')), 'sales.csv');
    const secondPath = join(mkdtempSync(join(tmpdir(), 'ax-sheet-read-')), 'sales.csv');
    writeFileSync(firstPath, 'name,total\nfirst,42\n');
    writeFileSync(secondPath, 'name,total\nfirst,42\n');

    const first = readWorkbookFromPath(firstPath);
    const repeated = readWorkbookFromPath(firstPath);
    const copied = readWorkbookFromPath(secondPath);

    expect(repeated.workbook.id).toBe(first.workbook.id);
    expect(repeated.workbook.sheets[0]?.tables[0]?.artifactId).toBe(first.workbook.sheets[0]?.tables[0]?.artifactId);
    expect(copied.workbook.id).toBe(first.workbook.id);
    expect(copied.workbook.sheets[0]?.tables[0]?.artifactId).toBe(first.workbook.sheets[0]?.tables[0]?.artifactId);
  });

  it('changes CSV workbook and table ids when the content changes', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ax-sheet-read-')), 'sales.csv');
    writeFileSync(path, 'name,total\nfirst,42\n');
    const before = readWorkbookFromPath(path);

    writeFileSync(path, 'name,total\nfirst,43\n');
    const after = readWorkbookFromPath(path);

    expect(after.workbook.id).not.toBe(before.workbook.id);
    expect(after.workbook.sheets[0]?.tables[0]?.artifactId).not.toBe(before.workbook.sheets[0]?.tables[0]?.artifactId);
  });

  it('rejects an oversized workbook before hashing or parsing it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ax-sheet-read-')), 'oversized.xlsx');
    writeFileSync(path, '');
    truncateSync(path, MAX_WORKBOOK_BYTES + 1);

    expect(() => readWorkbookFromPath(path)).toThrow('스프레드시트 파일이 너무 큽니다');
  });
});

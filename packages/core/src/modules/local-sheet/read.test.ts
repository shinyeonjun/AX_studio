import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { readSheetFromPath } from './read.js';

function writeWorkbook(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'ax-sheet-read-')), 'workbook.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['name'],
    ['first'],
  ]), 'First');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['name'],
    ['second'],
  ]), 'Second');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  return path;
}

describe('readSheetFromPath', () => {
  it('returns the requested sheet', () => {
    const table = readSheetFromPath({ path: writeWorkbook(), sheetName: 'Second' });

    expect(table.name).toBe('Second');
    expect(table.rows[0]?.values.name).toBe('second');
  });

  it('returns the first sheet when no sheet name is specified', () => {
    expect(readSheetFromPath({ path: writeWorkbook() }).name).toBe('First');
  });

  it('rejects an explicitly requested sheet that does not exist', () => {
    expect(() => readSheetFromPath({
      path: writeWorkbook(),
      sheetName: 'Missing',
    })).toThrow('sheet_not_found');
  });
});

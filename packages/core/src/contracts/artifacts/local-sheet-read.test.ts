import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

describe('local sheet read', () => {
  it('reads xlsx into workbook and sheet table artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-sheet-'));
    const path = join(dir, 'fixture.xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([
      ['amount', 'product'],
      [620000000, 'A'],
      [620000000, 'B'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'sales');
    XLSX.writeFile(workbook, path);

    const { readWorkbookFromPath } = await import('../../modules/local-sheet/read.js');
    const result = readWorkbookFromPath(path);
    expect(result.workbook.kind).toBe('workbook');
    expect(result.workbook.sheets).toHaveLength(1);
    const table = Object.values(result.tables)[0]!;
    expect(table.columns.map((column) => column.name)).toEqual(['amount', 'product']);
    expect(table.profile?.rowCount).toBe(2);
  });
});

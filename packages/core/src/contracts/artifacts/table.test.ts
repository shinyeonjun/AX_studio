import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { TableArtifactSchema } from './table.js';
import { buildTableArtifact } from '../../modules/local-sheet/profile.js';

describe('TableArtifact', () => {
  it('validates structured table rows and profile', () => {
    const artifact = buildTableArtifact({
      id: 'tbl_test',
      name: 'sales',
      headers: ['amount', 'week'],
      matrix: [[1000, '2026-W01'], [500, '2026-W02']],
    });
    expect(TableArtifactSchema.parse(artifact)).toMatchObject({
      kind: 'table',
      columns: expect.arrayContaining([
        expect.objectContaining({ name: 'amount', type: 'integer' }),
      ]),
      rows: expect.arrayContaining([
        expect.objectContaining({ index: 0, values: { amount: 1000, week: '2026-W01' } }),
      ]),
      profile: expect.objectContaining({ rowCount: 2, columnCount: 2 }),
    });
  });
});

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

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildContext, writeWorkbook } from './fixtures.js';
import { localSheetDiscoverySource } from '../discovery-source.js';

describe('local sheet discovery listing and profiling', () => {
  it('lists spreadsheet files from every connected folder and profiles them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sheet-discovery-'));
    const nested = join(root, 'nested');
    mkdirSync(nested);
    const csvPath = join(root, 'sales.csv');
    const xlsxPath = join(nested, 'sales.xlsx');
    const xlsPath = join(nested, 'legacy.xls');
    writeFileSync(csvPath, 'name,total\nfirst,42\n');
    writeWorkbook(xlsxPath);
    const legacyWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([['name'], ['legacy']]), 'Legacy');
    writeFileSync(xlsPath, XLSX.write(legacyWorkbook, { type: 'buffer', bookType: 'xls' }));
    writeFileSync(join(root, 'notes.txt'), 'ignore me');
    const { context } = await buildContext(root);

    const sources = await localSheetDiscoverySource.listSources(context);

    expect(sources).toHaveLength(3);
    expect(sources.map((source) => source.metadata?.extension).sort()).toEqual(['.csv', '.xls', '.xlsx']);
    expect(sources.map((source) => source.label).sort()).toEqual(['Reports/legacy.xls', 'Reports/sales.csv', 'Reports/sales.xlsx']);
    expect(sources.every((source) => source.kind === 'workbook')).toBe(true);

    const workbookSource = sources.find((source) => source.metadata?.extension === '.xlsx');
    expect(workbookSource).toBeTruthy();
    const profile = await localSheetDiscoverySource.profileSource(context, workbookSource!.id);

    expect(profile?.descriptor).toMatchObject({
      connector: 'local_sheet',
      kind: 'workbook',
      label: 'Reports/sales.xlsx',
    });
    expect(profile?.table.columns.map((column) => column.name)).toEqual(['name', 'total']);
    expect(profile?.table.rows[0]?.values).toMatchObject({ name: 'first', total: 42 });
    expect(context.budget.sourceReadsUsed).toBe(1);
  });
});

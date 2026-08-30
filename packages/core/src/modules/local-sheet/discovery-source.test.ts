import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { ArtifactStore } from '../../store/artifact-store.js';
import type { DiscoverySourceContext } from '../../contracts/discovery-source.js';
import { localSheetDiscoverySource } from './discovery-source.js';

function writeWorkbook(path: string): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['name', 'total'],
    ['first', 42],
  ]), 'Sales');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

async function buildContext(root: string) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.setConnection('local_folder', true, {
    folders: [{
      id: 'reports',
      label: 'Reports',
      path: root,
      addedAt: new Date(0).toISOString(),
    }],
  });
  const artifactStore = new ArtifactStore(join(root, '.artifacts'));
  const context: DiscoverySourceContext = {
    store,
    artifactStore,
    snapshotDir: join(root, '.snapshots'),
    exampleId: 'example-1',
    observations: [],
    inputArtifactIds: [],
    budget: { sourceReadsUsed: 0, sourceReadsMax: 10 },
  };
  return { context, store };
}

describe('local sheet discovery source', () => {
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

  it('rejects source IDs that point outside the connected folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sheet-discovery-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-sheet-outside-'));
    const outsidePath = join(outside, 'secret.csv');
    writeFileSync(outsidePath, 'secret\nvalue\n');
    const { context } = await buildContext(root);
    const sourceId = `sheet:${encodeURIComponent('reports')}:${encodeURIComponent(outsidePath)}`;

    await expect(localSheetDiscoverySource.profileSource(context, sourceId)).resolves.toBeNull();
  });

  it('skips inaccessible folders and treats corrupt workbooks as unprofileable sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sheet-discovery-'));
    const missing = join(root, 'missing');
    const corruptPath = join(root, 'broken.xlsx');
    writeFileSync(corruptPath, Buffer.alloc(0));
    const { context, store } = await buildContext(root);
    store.setConnection('local_folder', true, {
      folders: [
        { id: 'reports', label: 'Reports', path: root, addedAt: new Date(0).toISOString() },
        { id: 'missing', label: 'Missing', path: missing, addedAt: new Date(0).toISOString() },
      ],
    });

    const sources = await localSheetDiscoverySource.listSources(context);
    const corruptSource = sources.find((source) => source.metadata?.path === corruptPath);

    expect(sources).toHaveLength(1);
    expect(corruptSource).toBeTruthy();
    await expect(localSheetDiscoverySource.profileSource(context, corruptSource!.id)).resolves.toBeNull();
  });
});

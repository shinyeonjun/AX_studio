import { mkdtempSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { WorkbookArtifact } from '../../contracts/artifacts/workbook.js';
import { ArtifactStore } from '../../store/artifact-store.js';
import { observeArtifact } from './observe-artifact.js';
import { describe, expect, it } from 'vitest';

function materializeFixtureWorkbook(path: string): {
  workbook: WorkbookArtifact;
  tables: Record<string, TableArtifact>;
} {
  const tableId = 'table_fixture';
  const table: TableArtifact = {
    id: tableId,
    kind: 'table',
    name: 'report',
    columns: [{ name: 'total', type: 'number', nullable: true, inferred: true }],
    rows: [{ index: 0, values: { total: 300 } }],
    truncated: false,
    source: { filePath: path, workbookSheet: 'report' },
  };
  const workbook: WorkbookArtifact = {
    id: 'workbook_fixture',
    kind: 'workbook',
    file: { path, name: basename(path) },
    sheets: [{
      name: 'report',
      index: 0,
      visibility: 'visible',
      tables: [{ id: tableId, artifactId: tableId }],
      formulaCount: 0,
      imageCount: 0,
      chartCount: 0,
    }],
    namedRanges: [],
  };
  return { workbook, tables: { [tableId]: table } };
}

describe('observeArtifact', () => {
  it('observes a stored spreadsheet instead of treating its metadata as a document', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-observe-artifact-'));
    const sourcePath = join(root, 'report.csv');
    writeFileSync(sourcePath, 'total\n300\n');

    const artifactStore = new ArtifactStore(join(root, 'artifacts'));
    const stored = artifactStore.importFile(sourcePath);
    const observations = observeArtifact(
      'example-1',
      stored.id,
      artifactStore,
      materializeFixtureWorkbook,
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      path: 'total',
      value: { kind: 'number', value: 300 },
    });
  });

  it('observes a persisted workbook and its table artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-observe-workbook-'));
    const sourcePath = join(root, 'report.csv');
    writeFileSync(sourcePath, 'total\n300\n');
    const materialized = materializeFixtureWorkbook(sourcePath);
    const artifactStore = new ArtifactStore(join(root, 'artifacts'));

    artifactStore.putWorkbookArtifact(materialized.workbook.id, materialized.workbook);
    for (const [tableId, table] of Object.entries(materialized.tables)) {
      artifactStore.putTableArtifact(tableId, table);
    }

    const observations = observeArtifact(
      'example-2',
      materialized.workbook.id,
      artifactStore,
      materializeFixtureWorkbook,
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      path: 'total',
      value: { kind: 'number', value: 300 },
    });
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkbookFromPath } from '../../modules/local-sheet/read.js';
import { ArtifactStore } from '../../store/artifact-store.js';
import { observeArtifact } from './observe-artifact.js';

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
      readWorkbookFromPath,
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
    const materialized = readWorkbookFromPath(sourcePath);
    const artifactStore = new ArtifactStore(join(root, 'artifacts'));

    artifactStore.putWorkbookArtifact(materialized.workbook.id, materialized.workbook);
    for (const [tableId, table] of Object.entries(materialized.tables)) {
      artifactStore.putTableArtifact(tableId, table);
    }

    const observations = observeArtifact(
      'example-2',
      materialized.workbook.id,
      artifactStore,
      readWorkbookFromPath,
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      path: 'total',
      value: { kind: 'number', value: 300 },
    });
  });
});

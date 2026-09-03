import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { ArtifactStore } from '../../../store/artifact-store.js';
import type { DiscoverySourceContext } from '../../../contracts/discovery-source.js';

export function writeWorkbook(path: string): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['name', 'total'],
    ['first', 42],
  ]), 'Sales');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

export async function buildContext(root: string) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.setConnection('local_folder', true, {
    folders: [{ id: 'reports', label: 'Reports', path: root, addedAt: new Date(0).toISOString() }],
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

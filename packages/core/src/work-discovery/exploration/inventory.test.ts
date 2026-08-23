import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { ArtifactStore } from '../../store/artifact-store.js';
import { createDefaultDiscoverySourceRegistry } from '../sources/index.js';
import { inventorySources } from './inventory.js';
import type { OutputObservation } from '../observation/schema.js';

describe('inventorySources', () => {
  it('profiles input artifact sources within budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-'));
    const snapshotDir = join(dir, 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const artifactStore = new ArtifactStore(join(dir, 'artifacts'));

    const salesPath = join(dir, 'sales.csv');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(salesPath, 'amount,product\n100,A\n100,B\n');
    const imported = artifactStore.importFile(salesPath);

    const observations: OutputObservation[] = [{
      id: 'obs_1',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number', value: 200, display: '200' },
      role: 'dynamic_value',
      required: true,
    }];

    const registry = createDefaultDiscoverySourceRegistry(store, artifactStore);
    const result = await inventorySources(registry, {
      store,
      artifactStore,
      snapshotDir,
      exampleId: 'ex_1',
      observations,
      inputArtifactIds: [imported.id],
      budget: { sourceReadsUsed: 0, sourceReadsMax: 2 },
    });

    expect(result.sources.some((source) => source.id === `input:${imported.id}`)).toBe(true);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.table?.columns.some((column) => column.name === 'amount')).toBe(true);
  });
});

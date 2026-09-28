import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inventorySources } from './exploration/inventory.js';
import { DiscoverySourceRegistry } from './sources/registry.js';
import { loadPersistedSnapshotTables } from './snapshot.js';
import { tableArtifactFromRows } from '../contracts/artifacts/table-build.js';
import { ArtifactStore } from '../persistence/artifact-store.js';
import { createDatabaseAsync } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { makeSession } from './service/fixtures.js';

const directories: string[] = [];
const databases: Array<Awaited<ReturnType<typeof createDatabaseAsync>>> = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close?.();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const source = { id: 'rdb:orders', connector: 'rdb', label: 'orders', kind: 'table' as const, relevance: 0 };

async function capturePair() {
  const dir = mkdtempSync(join(tmpdir(), 'ax-snapshot-isolation-')); directories.push(dir);
  const db = await createDatabaseAsync(':memory:');
  databases.push(db);
  const store = new WorkflowStore(db);
  const artifactStore = new ArtifactStore(join(dir, 'artifacts'));
  const timestamp = new Date().toISOString();
  const state = makeSession('session', {
    exampleIds: [],
    sourceInventory: [source],
    observations: [],
    candidates: [],
    pendingQuestion: undefined,
  });
  store.saveDiscoverySession(state);
  const firstExample = store.insertDiscoveryExample({
    sessionId: state.id,
    label: 'e1',
    outputArtifactIds: [],
    inputArtifactIds: [],
  });
  const secondExample = store.insertDiscoveryExample({
    sessionId: state.id,
    label: 'e2',
    outputArtifactIds: [],
    inputArtifactIds: [],
  });
  const exampleIds = [firstExample.id, secondExample.id];
  state.exampleIds = exampleIds;
  store.saveDiscoverySession(state);
  const registry = new DiscoverySourceRegistry([{ connector: 'rdb', listSources: async () => [source],
    profileSource: async ctx => ({ descriptor: source, fingerprint: ctx.exampleId,
      table: tableArtifactFromRows([{ amount: ctx.exampleId === firstExample.id ? 100 : 200 }],
        { id: 'same-query', name: 'orders', rowLimit: 10 })!,
    }),
  }]);
  const capture = (exampleId: string) => inventorySources(registry, {
    store, artifactStore,
    exampleId, snapshotDir: dir, observations: [], inputArtifactIds: [],
    budget: { sourceReadsUsed: 0, sourceReadsMax: 10 },
  });
  const a = await capture(firstExample.id), b = await capture(secondExample.id);
  for (const snapshot of [...a.snapshots, ...b.snapshots]) {
    store.upsertDiscoverySnapshot({
      id: `${snapshot.id}_${snapshot.exampleId}`,
      sessionId: state.id,
      exampleId: snapshot.exampleId,
      sourceId: snapshot.sourceId,
      kind: snapshot.kind,
      manifestPath: snapshot.manifestPath,
      fingerprint: snapshot.fingerprint,
      capturedAt: timestamp,
    });
  }
  const load = () => loadPersistedSnapshotTables(store, state, exampleIds);
  return { a, b, load };
}
describe('immutable discovery snapshots', () => {
  it('preserves distinct example captures with the same provider table id', async () => {
    const { a, b, load } = await capturePair();
    expect(a.snapshots[0]!.manifestPath).not.toBe(b.snapshots[0]!.manifestPath);
    expect(load()?.[a.snapshots[0]!.exampleId]?.[source.id]?.rows[0]?.values.amount).toBe(100);
    expect(load()?.[b.snapshots[0]!.exampleId]?.[source.id]?.rows[0]?.values.amount).toBe(200);
  });
  it('rejects a valid-looking but altered persisted table', async () => {
    const { a, load } = await capturePair();
    const path = a.snapshots[0]!.manifestPath!;
    writeFileSync(path, readFileSync(path, 'utf8').replace('100', '999'));
    expect(load()).toBeUndefined();
  });
});

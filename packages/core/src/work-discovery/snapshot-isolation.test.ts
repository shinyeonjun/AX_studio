import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inventorySources } from './exploration/inventory.js';
import { DiscoverySourceRegistry } from './sources/registry.js';
import { loadPersistedSnapshotTables } from './snapshot.js';
import { tableArtifactFromRows } from '../contracts/artifacts/table-build.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const source = { id: 'rdb:orders', connector: 'rdb', label: 'orders', kind: 'table' as const, relevance: 0 };

async function capturePair() {
  const dir = mkdtempSync(join(tmpdir(), 'ax-snapshot-isolation-')); directories.push(dir);
  const registry = new DiscoverySourceRegistry([{ connector: 'rdb', listSources: async () => [source],
    profileSource: async ctx => ({ descriptor: source, fingerprint: ctx.exampleId,
      table: tableArtifactFromRows([{ amount: ctx.exampleId === 'e1' ? 100 : 200 }],
        { id: 'same-query', name: 'orders', rowLimit: 10 })!,
    }),
  }]);
  const capture = (exampleId: string) => inventorySources(registry, {
    exampleId, snapshotDir: dir, observations: [], inputArtifactIds: [],
    budget: { sourceReadsUsed: 0, sourceReadsMax: 10 },
  } as Parameters<typeof inventorySources>[1]);
  const a = await capture('e1'), b = await capture('e2');
  const records = [...a.snapshots, ...b.snapshots];
  const load = () => loadPersistedSnapshotTables(
    { listDiscoverySnapshots: () => records } as Parameters<typeof loadPersistedSnapshotTables>[0],
    { id: 'session', sourceInventory: [source] } as Parameters<typeof loadPersistedSnapshotTables>[1], ['e1', 'e2']);
  return { a, b, load };
}
describe('immutable discovery snapshots', () => {
  it('preserves distinct example captures with the same provider table id', async () => {
    const { a, b, load } = await capturePair();
    expect(a.snapshots[0]!.manifestPath).not.toBe(b.snapshots[0]!.manifestPath);
    expect(load()?.e1?.[source.id]?.rows[0]?.values.amount).toBe(100);
    expect(load()?.e2?.[source.id]?.rows[0]?.values.amount).toBe(200);
  });
  it('rejects a valid-looking but altered persisted table', async () => {
    const { a, load } = await capturePair();
    const path = a.snapshots[0]!.manifestPath!;
    writeFileSync(path, readFileSync(path, 'utf8').replace('100', '999'));
    expect(load()).toBeUndefined();
  });
});

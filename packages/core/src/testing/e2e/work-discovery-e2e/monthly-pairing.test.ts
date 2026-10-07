import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { ArtifactStore } from '../../../persistence/artifact-store.js';
import { WorkDiscoveryService } from '../../../work-discovery/service.js';
import { loadPersistedSnapshotTables } from '../../../work-discovery/snapshot.js';
import { readWorkbookFromPath } from '../../../connectors/local-sheet/read/workbook.js';
import { writeSalesXlsx } from './fixtures.js';

const SETTLED = new Set(['needs_clarification', 'ready_to_publish', 'needs_attention', 'failed', 'cancelled']);

function report(artifactStore: ArtifactStore, artifactId: string, totalSales: number, orderCount: number): void {
  const text = `총매출: ${totalSales}\n주문수: ${orderCount}`;
  artifactStore.putDocumentArtifact(artifactId, { id: artifactId, text, pages: [{ index: 0, text }], tables: [], images: [] });
}

async function settle(store: WorkflowStore, sessionId: string) {
  for (let waited = 0; waited < 20_000; waited += 50) {
    const state = store.getDiscoverySessionState(sessionId);
    if (state && SETTLED.has(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return store.getDiscoverySessionState(sessionId);
}

describe('two monthly reports, each made from its own month of data', () => {
  it('learns one rule that reads each month its own file', async () => {
    const dir = join(tmpdir(), `ax-wd-pairing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    // Names carry no shared digits with the reports, so only the data can pair them.
    const first = join(dir, 'orders-a.xlsx');
    const second = join(dir, 'orders-b.xlsx');
    writeSalesXlsx(first, [
      { amount: 100, actual: 50, target: 80 },
      { amount: 200, actual: 50, target: 60 },
      { amount: 300, actual: 50, target: 60 },
    ]);
    writeSalesXlsx(second, [
      { amount: 400, actual: 10, target: 10 },
      { amount: 500, actual: 10, target: 10 },
    ]);

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const artifactStore = new ArtifactStore(join(dir, 'artifacts'));
    const snapshotDir = join(dir, 'snapshots');
    const service = new WorkDiscoveryService({ store, artifactStore, snapshotDir, materializeWorkbook: readWorkbookFromPath });
    const inputs = [artifactStore.importFile(first), artifactStore.importFile(second)];
    // Reports listed in the opposite order to the files: the first report is the second file's.
    report(artifactStore, 'report_b', 900, 2);
    report(artifactStore, 'report_a', 600, 3);

    const started = service.start({
      goal: '월간 매출 보고 자동화',
      exampleArtifactIds: ['report_b', 'report_a'],
      inputArtifactIds: inputs.map((input) => input.id),
    });
    const settled = await settle(store, started.id);

    expect(settled?.status === 'needs_clarification' || settled?.status === 'ready_to_publish').toBe(true);
    const accepted = (settled?.candidates ?? []).filter((candidate) => candidate.status === 'accepted');
    const total = accepted.find((candidate) => candidate.observationPath === 'field.총매출');
    expect(total?.replayResults.map((entry) => entry.pass)).toEqual([true, true]);
    expect(accepted.some((candidate) => candidate.observationPath === 'field.주문수')).toBe(true);

    // The pairing is saved: resuming or replaying history sees each example's own month.
    const [exampleB, exampleA] = settled!.exampleIds;
    const snapshots = loadPersistedSnapshotTables(store, settled!, settled!.exampleIds)!;
    const sharedId = `input:${inputs[1]!.id}`;
    expect(snapshots[exampleB!]![sharedId]!.rows).toHaveLength(2);
    expect(snapshots[exampleA!]![sharedId]!.rows).toHaveLength(3);
    db.close?.();
  }, 30_000);

  it('uses the file given to each report, and can resume from that checkpoint', async () => {
    const dir = join(tmpdir(), `ax-wd-pairing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const first = join(dir, 'orders-a.xlsx');
    const second = join(dir, 'orders-b.xlsx');
    writeSalesXlsx(first, [{ amount: 100, actual: 1, target: 1 }, { amount: 200, actual: 1, target: 1 }]);
    writeSalesXlsx(second, [{ amount: 700, actual: 1, target: 1 }]);
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const artifactStore = new ArtifactStore(join(dir, 'artifacts'));
    const service = new WorkDiscoveryService({ store, artifactStore, snapshotDir: join(dir, 'snapshots'), materializeWorkbook: readWorkbookFromPath });
    const [a, b] = [artifactStore.importFile(first), artifactStore.importFile(second)];
    report(artifactStore, 'report_a', 300, 2);
    report(artifactStore, 'report_b', 700, 1);

    const started = service.start({
      goal: '월간 매출 보고 자동화',
      exampleArtifactIds: ['report_a', 'report_b'],
      exampleInputArtifactIds: [[a.id], [b.id]],
    });
    const settled = await settle(store, started.id);
    const total = settled?.candidates.find((candidate) => candidate.status === 'accepted' && candidate.observationPath === 'field.총매출');
    expect(total?.replayResults.map((entry) => entry.pass)).toEqual([true, true]);
    // Each example was given one file; the saved checkpoint is still whole.
    expect(loadPersistedSnapshotTables(store, settled!, settled!.exampleIds)).toBeDefined();
    db.close?.();
  }, 30_000);
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import type { DiscoverySourceProvider } from '../../../../contracts/discovery-source.js';
import type { DiscoverySessionState } from '../../../schema.js';
import { WorkDiscoveryService } from '../../../service.js';
import { DiscoverySourceRegistry } from '../../../sources/registry.js';

describe('WorkDiscoveryService persisted checkpoint recovery', () => {
  it.each(['synthesizing', 'validating'] as const)('resumes a %s checkpoint from persisted snapshots without rereading live sources', async (checkpointStatus) => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-recovery-'));
    const snapshotDir = join(dir, 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const now = new Date().toISOString();
    const source = {
      id: 'test:sales',
      connector: 'test',
      label: 'Sales',
      kind: 'table' as const,
      relevance: 1,
    };
    const baseState: DiscoverySessionState = {
      id: 'wd_recovery',
      status: checkpointStatus,
      revision: 4,
      userGoal: '저장된 자료로 매출 보고 자동화',
      exampleIds: [],
      sourceInventory: [source],
      observations: [],
      candidates: [],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 12, elapsedMs: 10 },
      createdAt: now,
      updatedAt: now,
    };
    store.saveDiscoverySession(baseState);
    const example = store.insertDiscoveryExample({
      sessionId: 'wd_recovery',
      outputArtifactIds: ['output_already_observed'],
      inputArtifactIds: [],
    });
    const table = buildTableArtifact({
      id: 'table_recovery',
      headers: ['amount'],
      matrix: [[100]],
    });
    const manifestPath = join(snapshotDir, `${table.id}.json`);
    writeFileSync(manifestPath, JSON.stringify(table));
    const observations = [{
      id: 'observation_recovery_total',
      exampleId: example.id,
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number' as const, value: 100, display: '100' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    store.saveDiscoverySession({
      ...baseState,
      exampleIds: [example.id],
      observations,
    });
    store.insertDiscoverySnapshot({
      id: 'snap_recovery',
      sessionId: 'wd_recovery',
      exampleId: example.id,
      sourceId: source.id,
      kind: 'table',
      artifactId: table.id,
      manifestPath,
      fingerprint: 'fingerprint_recovery',
      metadataJson: JSON.stringify({ connector: source.connector }),
      capturedAt: now,
    });
    const provider: DiscoverySourceProvider = {
      connector: 'test',
      async listSources() {
        throw new Error('live source must not be read during checkpoint recovery');
      },
      async profileSource() {
        throw new Error('live source must not be read during checkpoint recovery');
      },
    };

    new WorkDiscoveryService({
      store,
      snapshotDir,
      sourceRegistry: new DiscoverySourceRegistry([provider]),
      autoResume: true,
    });

    let recovered: DiscoverySessionState | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      recovered = store.getDiscoverySessionState('wd_recovery');
      if (recovered?.status !== checkpointStatus) break;
    }

    expect(recovered?.status).toBe('needs_clarification');
    expect(store.listDiscoveryReplayCases('wd_recovery')).toHaveLength(1);
    expect(recovered?.observations).toEqual(observations);
    db.close?.();
  }, 10_000);
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
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

describe('a checkpoint whose snapshots are gone', () => {
  it('is started over from the examples when the person retries, instead of failing every retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-recovery-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const now = new Date().toISOString();
    const state: DiscoverySessionState = {
      id: 'wd_lost', status: 'synthesizing', revision: 1, userGoal: '매출 보고 자동화',
      exampleIds: [], sourceInventory: [{ id: 'test:sales', connector: 'test', label: 'Sales', kind: 'table', relevance: 1 }],
      observations: [], candidates: [],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 12, elapsedMs: 10 },
      createdAt: now, updatedAt: now,
    };
    store.saveDiscoverySession(state);
    const example = store.insertDiscoveryExample({ sessionId: 'wd_lost', outputArtifactIds: [], inputArtifactIds: [] });
    store.saveDiscoverySession({ ...state, exampleIds: [example.id] });
    let listed = 0;
    const provider: DiscoverySourceProvider = {
      connector: 'test',
      async listSources() { listed += 1; return []; },
      async profileSource() { throw new Error('no source to profile'); },
    };
    const service = new WorkDiscoveryService({
      store, snapshotDir: join(dir, 'snapshots'), sourceRegistry: new DiscoverySourceRegistry([provider]), autoResume: true,
    });
    const settle = async (done: (current: DiscoverySessionState | undefined) => boolean) => {
      for (let attempt = 0; attempt < 250; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        if (done(store.getDiscoverySessionState('wd_lost'))) break;
      }
      return store.getDiscoverySessionState('wd_lost');
    };

    // Automatic recovery keeps what it has and asks the person.
    const paused = await settle((current) => current?.status === 'needs_attention');
    expect(paused?.status).toBe('needs_attention');
    expect(listed).toBe(0);

    expect(service.retry('wd_lost', paused!.revision)).not.toHaveProperty('error');
    await settle(() => listed > 0);
    expect(listed).toBeGreaterThan(0);
    db.close?.();
  }, 10_000);
});

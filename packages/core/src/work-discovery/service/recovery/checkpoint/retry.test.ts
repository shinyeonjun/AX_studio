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

describe('WorkDiscoveryService checkpoint retry', () => {
  it('moves a failed automatic recovery to needs_attention and retries from the saved checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-retry-'));
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
      id: 'wd_retry',
      status: 'synthesizing',
      revision: 4,
      userGoal: '복구 재시도 테스트',
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
      sessionId: 'wd_retry',
      outputArtifactIds: ['output_already_observed'],
      inputArtifactIds: [],
    });
    const observations = [{
      id: 'observation_retry_total',
      exampleId: example.id,
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number' as const, value: 100, display: '100' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const table = buildTableArtifact({ id: 'table_retry', headers: ['amount'], matrix: [[100]] });
    const manifestPath = join(snapshotDir, `${table.id}.json`);
    store.saveDiscoverySession({
      ...baseState,
      exampleIds: [example.id],
      observations,
    });
    store.insertDiscoverySnapshot({
      id: 'snap_retry',
      sessionId: 'wd_retry',
      exampleId: example.id,
      sourceId: source.id,
      kind: 'table',
      artifactId: table.id,
      manifestPath,
      fingerprint: 'fingerprint_retry',
      capturedAt: now,
    });

    const service = new WorkDiscoveryService({
      store,
      snapshotDir,
      sourceRegistry: new DiscoverySourceRegistry([]),
      autoResume: true,
    });

    let needsAttention: DiscoverySessionState | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      needsAttention = store.getDiscoverySessionState('wd_retry');
      if (needsAttention?.status === 'needs_attention') break;
    }

    expect(needsAttention?.status).toBe('needs_attention');
    expect(needsAttention?.recoveryCheckpoint).toBe('synthesizing');
    expect(needsAttention?.errorCode).toBe('discovery_recovery_failed');
    expect(service.inspect('wd_retry')).toMatchObject({
      status: 'needs_attention',
      recoveryCheckpoint: 'synthesizing',
      autoRecoveryAttempts: 1,
    });

    writeFileSync(manifestPath, JSON.stringify(table));
    const retried = service.retry('wd_retry', needsAttention!.revision);
    expect(retried).toMatchObject({ status: 'synthesizing' });

    let recovered: DiscoverySessionState | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      recovered = store.getDiscoverySessionState('wd_retry');
      if (recovered?.status === 'needs_clarification') break;
    }
    expect(recovered?.status).toBe('needs_clarification');
    expect(store.listDiscoveryReplayCases('wd_retry')).toHaveLength(1);
    db.close?.();
  }, 15_000);
});

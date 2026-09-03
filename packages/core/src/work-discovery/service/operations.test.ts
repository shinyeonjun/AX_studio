import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { WorkDiscoveryService } from '../service.js';

describe('WorkDiscoveryService', () => {
  it('cancel marks session as cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-cancel-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });
    const now = new Date().toISOString();
    store.saveDiscoverySession({
      id: 'wd_cancel',
      status: 'observing_output',
      revision: 1,
      userGoal: 'cancel test',
      exampleIds: [],
      sourceInventory: [],
      observations: [],
      candidates: [],
      budgets: {
        sourceReadsUsed: 0,
        sourceReadsMax: 12,
        elapsedMs: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    const cancelled = service.cancel('wd_cancel');
    expect(cancelled?.status).toBe('cancelled');
    db.close?.();
  });

  it('persists the desired recurrence in the session state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-recurrence-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });

    const started = service.start({
      goal: '매일 매출 보고 자동화',
      exampleArtifactIds: ['output_report'],
      desiredRecurrence: '0 9 * * 1-5',
    });

    expect(store.getDiscoverySessionState(started.id)?.desiredRecurrence).toBe('0 9 * * 1-5');
    service.cancel(started.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    db.close?.();
  });
});

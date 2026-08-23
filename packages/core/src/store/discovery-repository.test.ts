import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import {
  getDiscoverySession,
  insertDiscoveryExample,
  insertDiscoverySession,
} from './repositories/work-discovery-repository.js';
import type { DiscoverySessionState } from '../work-discovery/schema.js';

describe('discovery persistence', () => {
  it('persists session state across database reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-db-'));
    const dbPath = join(dir, 'ax.db');
    const now = new Date().toISOString();
    const state: DiscoverySessionState = {
      id: 'wd_test_session',
      status: 'collecting_examples',
      revision: 1,
      userGoal: '월간 보고',
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
    };

    const db1 = await createDatabaseAsync(dbPath);
    insertDiscoverySession(db1, state);
    insertDiscoveryExample(db1, {
      sessionId: state.id,
      outputArtifactIds: ['doc_rev'],
      inputArtifactIds: [],
    });
    db1.close?.();

    const db2 = await createDatabaseAsync(dbPath);
    const loaded = getDiscoverySession(db2, state.id);
    expect(loaded?.userGoal).toBe('월간 보고');
    expect(loaded?.status).toBe('collecting_examples');
    db2.close?.();
  });
});

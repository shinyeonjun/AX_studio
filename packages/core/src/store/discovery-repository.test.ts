import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import {
  getDiscoverySession,
  insertDiscoveryExample,
  insertDiscoverySession,
  listDiscoveryReplayCases,
  upsertDiscoveryReplayCase,
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

  it('upserts one replay case per session example', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    const state: DiscoverySessionState = {
      id: 'wd_replay_case',
      status: 'synthesizing',
      revision: 1,
      userGoal: '월간 보고',
      exampleIds: ['ex_replay_case'],
      sourceInventory: [],
      observations: [],
      candidates: [],
      budgets: { sourceReadsUsed: 0, sourceReadsMax: 12, elapsedMs: 0 },
      createdAt: now,
      updatedAt: now,
    };
    insertDiscoverySession(db, state);
    insertDiscoveryExample(db, {
      sessionId: state.id,
      outputArtifactIds: ['doc_replay'],
      inputArtifactIds: [],
    });

    upsertDiscoveryReplayCase(db, {
      id: 'replay_wd_replay_case_ex_replay_case',
      sessionId: state.id,
      exampleId: 'ex_replay_case',
      snapshotSetId: 'snapset_wd_replay_case_ex_replay_case',
      expectedObservationsJson: '[{"path":"field.total","value":100}]',
      lastResultJson: '[{"candidateId":"candidate_1","pass":false}]',
      createdAt: now,
    });
    upsertDiscoveryReplayCase(db, {
      id: 'replay_wd_replay_case_ex_replay_case',
      sessionId: state.id,
      exampleId: 'ex_replay_case',
      snapshotSetId: 'snapset_wd_replay_case_ex_replay_case',
      expectedObservationsJson: '[{"path":"field.total","value":100}]',
      lastResultJson: '[{"candidateId":"candidate_1","pass":true}]',
      createdAt: now,
    });

    const cases = listDiscoveryReplayCases(db, state.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.lastResultJson).toContain('"pass":true');
    db.close?.();
  });
});

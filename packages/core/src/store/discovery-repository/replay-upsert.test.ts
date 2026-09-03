import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import {
  insertDiscoveryExample,
  insertDiscoverySession,
  listDiscoveryReplayCases,
  upsertDiscoveryReplayCase,
} from '../repositories/work-discovery-repository.js';
import type { DiscoverySessionState } from '../../work-discovery/schema.js';

describe('discovery replay persistence', () => {
  it('upserts one replay case per session example', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    const state: DiscoverySessionState = {
      id: 'wd_replay_case', status: 'synthesizing', revision: 1, userGoal: '월간 보고', exampleIds: [],
      sourceInventory: [], observations: [], candidates: [], budgets: { sourceReadsUsed: 0, sourceReadsMax: 12, elapsedMs: 0 },
      createdAt: now, updatedAt: now,
    };
    insertDiscoverySession(db, state);
    const example = insertDiscoveryExample(db, { sessionId: state.id, outputArtifactIds: ['doc_replay'], inputArtifactIds: [] });

    upsertDiscoveryReplayCase(db, {
      id: 'replay_wd_replay_case_ex_replay_case', sessionId: state.id, exampleId: example.id,
      snapshotSetId: 'snapset_wd_replay_case_ex_replay_case', expectedObservationsJson: '[{"path":"field.total","value":100}]',
      lastResultJson: '[{"candidateId":"candidate_1","pass":false}]', createdAt: now,
    });
    upsertDiscoveryReplayCase(db, {
      id: 'replay_wd_replay_case_ex_replay_case', sessionId: state.id, exampleId: example.id,
      snapshotSetId: 'snapset_wd_replay_case_ex_replay_case', expectedObservationsJson: '[{"path":"field.total","value":100}]',
      lastResultJson: '[{"candidateId":"candidate_1","pass":true}]', createdAt: now,
    });

    const cases = listDiscoveryReplayCases(db, state.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.lastResultJson).toContain('"pass":true');
    db.close?.();
  });
});

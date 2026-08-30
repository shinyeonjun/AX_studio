import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import {
  getDiscoverySession,
  insertDiscoveryExample,
  insertDiscoverySession,
  listDiscoveryExamples,
  listDiscoveryReplayCases,
  listDiscoverySessions,
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
    expect(listDiscoveryExamples(db2, state.id)).toEqual([
      expect.objectContaining({ outputArtifactIds: ['doc_rev'], inputArtifactIds: [] }),
    ]);
    db2.close?.();
  });

  it('reports malformed session JSON with the affected session id', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_discovery_sessions
        (id, status, revision, user_goal, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('wd_corrupt', 'collecting_examples', 1, '월간 보고', '{', now, now);

    expect(() => getDiscoverySession(db, 'wd_corrupt')).toThrowError(
      expect.objectContaining({ code: 'invalid_discovery_session_json', sessionId: 'wd_corrupt' }),
    );
    expect(() => listDiscoverySessions(db)).toThrowError(
      expect.objectContaining({ code: 'invalid_discovery_session_json', sessionId: 'wd_corrupt' }),
    );
    db.close?.();
  });

  it('rejects stored session JSON that does not match the discovery schema', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_discovery_sessions
        (id, status, revision, user_goal, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'wd_invalid',
      'collecting_examples',
      1,
      '월간 보고',
      JSON.stringify({ id: 'wd_invalid', status: 'collecting_examples' }),
      now,
      now,
    );

    expect(() => getDiscoverySession(db, 'wd_invalid')).toThrowError(
      expect.objectContaining({ code: 'invalid_discovery_session_state', sessionId: 'wd_invalid' }),
    );
    db.close?.();
  });

  it('reports malformed artifact ids with the affected example and field', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_discovery_sessions
        (id, status, revision, user_goal, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('wd_corrupt_example', 'collecting_examples', 1, '월간 보고', '{}', now, now);
    const example = insertDiscoveryExample(db, {
      sessionId: 'wd_corrupt_example',
      outputArtifactIds: ['doc_output'],
      inputArtifactIds: ['doc_input'],
    });
    db.prepare('UPDATE work_discovery_examples SET input_artifact_ids_json = ? WHERE id = ?')
      .run('{', example.id);

    expect(() => listDiscoveryExamples(db, 'wd_corrupt_example')).toThrowError(expect.objectContaining({
      code: 'invalid_discovery_example_json',
      exampleId: example.id,
      field: 'input_artifact_ids',
    }));
    db.close?.();
  });

  it('rejects artifact id JSON that is not a string array', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_discovery_sessions
        (id, status, revision, user_goal, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('wd_invalid_example', 'collecting_examples', 1, '월간 보고', '{}', now, now);
    const example = insertDiscoveryExample(db, {
      sessionId: 'wd_invalid_example',
      outputArtifactIds: ['doc_output'],
      inputArtifactIds: [],
    });
    db.prepare('UPDATE work_discovery_examples SET output_artifact_ids_json = ? WHERE id = ?')
      .run('["doc_output", 42]', example.id);

    expect(() => listDiscoveryExamples(db, 'wd_invalid_example')).toThrowError(expect.objectContaining({
      code: 'invalid_discovery_example_artifact_ids',
      exampleId: example.id,
      field: 'output_artifact_ids',
    }));
    db.close?.();
  });

  it('upserts one replay case per session example', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    const state: DiscoverySessionState = {
      id: 'wd_replay_case',
      status: 'synthesizing',
      revision: 1,
      userGoal: '월간 보고',
      exampleIds: [],
      sourceInventory: [],
      observations: [],
      candidates: [],
      budgets: { sourceReadsUsed: 0, sourceReadsMax: 12, elapsedMs: 0 },
      createdAt: now,
      updatedAt: now,
    };
    insertDiscoverySession(db, state);
    const example = insertDiscoveryExample(db, {
      sessionId: state.id,
      outputArtifactIds: ['doc_replay'],
      inputArtifactIds: [],
    });

    upsertDiscoveryReplayCase(db, {
      id: 'replay_wd_replay_case_ex_replay_case',
      sessionId: state.id,
      exampleId: example.id,
      snapshotSetId: 'snapset_wd_replay_case_ex_replay_case',
      expectedObservationsJson: '[{"path":"field.total","value":100}]',
      lastResultJson: '[{"candidateId":"candidate_1","pass":false}]',
      createdAt: now,
    });
    upsertDiscoveryReplayCase(db, {
      id: 'replay_wd_replay_case_ex_replay_case',
      sessionId: state.id,
      exampleId: example.id,
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

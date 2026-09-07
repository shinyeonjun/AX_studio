import type { AppDatabase } from '../../db.js';
import type { DiscoveryReplayCaseRecord } from './contracts.js';

export function upsertDiscoveryReplayCase(db: AppDatabase, replayCase: DiscoveryReplayCaseRecord): void {
  db.prepare(
    `INSERT INTO work_discovery_replay_cases
      (id, session_id, example_id, snapshot_set_id, expected_observations_json, last_result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       session_id = excluded.session_id,
       example_id = excluded.example_id,
       snapshot_set_id = excluded.snapshot_set_id,
       expected_observations_json = excluded.expected_observations_json,
       last_result_json = excluded.last_result_json`,
  ).run(
    replayCase.id,
    replayCase.sessionId,
    replayCase.exampleId,
    replayCase.snapshotSetId,
    replayCase.expectedObservationsJson,
    replayCase.lastResultJson ?? null,
    replayCase.createdAt,
  );
}

export function listDiscoveryReplayCases(db: AppDatabase, sessionId: string): DiscoveryReplayCaseRecord[] {
  const rows = db.prepare(
    'SELECT * FROM work_discovery_replay_cases WHERE session_id = ? ORDER BY created_at ASC, id ASC',
  ).all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    exampleId: String(row.example_id),
    snapshotSetId: String(row.snapshot_set_id),
    expectedObservationsJson: String(row.expected_observations_json),
    lastResultJson: row.last_result_json ? String(row.last_result_json) : undefined,
    createdAt: String(row.created_at),
  }));
}

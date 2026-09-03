import type { AppDatabase } from '../../db.js';
import type { DiscoverySnapshotRecord } from './contracts.js';

export function insertDiscoverySnapshot(db: AppDatabase, snapshot: DiscoverySnapshotRecord): void {
  db.prepare(
    `INSERT INTO work_discovery_snapshots
      (id, session_id, example_id, source_id, kind, artifact_id, manifest_path, fingerprint, query_json, metadata_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.id,
    snapshot.sessionId,
    snapshot.exampleId,
    snapshot.sourceId,
    snapshot.kind,
    snapshot.artifactId ?? null,
    snapshot.manifestPath ?? null,
    snapshot.fingerprint,
    snapshot.queryJson ?? null,
    snapshot.metadataJson ?? null,
    snapshot.capturedAt,
  );
}

export function upsertDiscoverySnapshot(db: AppDatabase, snapshot: DiscoverySnapshotRecord): void {
  db.prepare(
    `INSERT INTO work_discovery_snapshots
      (id, session_id, example_id, source_id, kind, artifact_id, manifest_path, fingerprint, query_json, metadata_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       session_id = excluded.session_id,
       example_id = excluded.example_id,
       source_id = excluded.source_id,
       kind = excluded.kind,
       artifact_id = excluded.artifact_id,
       manifest_path = excluded.manifest_path,
       fingerprint = excluded.fingerprint,
       query_json = excluded.query_json,
       metadata_json = excluded.metadata_json,
       captured_at = excluded.captured_at`,
  ).run(
    snapshot.id,
    snapshot.sessionId,
    snapshot.exampleId,
    snapshot.sourceId,
    snapshot.kind,
    snapshot.artifactId ?? null,
    snapshot.manifestPath ?? null,
    snapshot.fingerprint,
    snapshot.queryJson ?? null,
    snapshot.metadataJson ?? null,
    snapshot.capturedAt,
  );
}

export function listDiscoverySnapshots(db: AppDatabase, sessionId: string): DiscoverySnapshotRecord[] {
  const rows = db.prepare(
    'SELECT * FROM work_discovery_snapshots WHERE session_id = ? ORDER BY captured_at ASC',
  ).all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    exampleId: String(row.example_id),
    sourceId: String(row.source_id),
    kind: String(row.kind),
    artifactId: row.artifact_id ? String(row.artifact_id) : undefined,
    manifestPath: row.manifest_path ? String(row.manifest_path) : undefined,
    fingerprint: String(row.fingerprint),
    queryJson: row.query_json ? String(row.query_json) : undefined,
    metadataJson: row.metadata_json ? String(row.metadata_json) : undefined,
    capturedAt: String(row.captured_at),
  }));
}

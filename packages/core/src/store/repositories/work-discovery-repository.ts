import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { DiscoverySessionState } from '../../work-discovery/schema.js';

export interface DiscoveryExampleRecord {
  id: string;
  sessionId: string;
  label?: string;
  outputArtifactIds: string[];
  inputArtifactIds: string[];
  observationsJson: string;
  createdAt: string;
}

export interface DiscoverySnapshotRecord {
  id: string;
  sessionId: string;
  exampleId: string;
  sourceId: string;
  kind: string;
  artifactId?: string;
  manifestPath?: string;
  fingerprint: string;
  queryJson?: string;
  metadataJson?: string;
  capturedAt: string;
}

export function insertDiscoverySession(db: AppDatabase, state: DiscoverySessionState): void {
  db.prepare(
    `INSERT INTO work_discovery_sessions
      (id, status, revision, user_goal, state_json, published_workflow_id, error_code, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    state.id,
    state.status,
    state.revision,
    state.userGoal,
    JSON.stringify(state),
    state.publishedWorkflowId ?? null,
    state.errorCode ?? null,
    state.errorMessage ?? null,
    state.createdAt,
    state.updatedAt,
  );
}

export function updateDiscoverySession(db: AppDatabase, state: DiscoverySessionState): void {
  db.prepare(
    `UPDATE work_discovery_sessions
     SET status = ?, revision = ?, user_goal = ?, state_json = ?, published_workflow_id = ?, error_code = ?, error_message = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    state.status,
    state.revision,
    state.userGoal,
    JSON.stringify(state),
    state.publishedWorkflowId ?? null,
    state.errorCode ?? null,
    state.errorMessage ?? null,
    state.updatedAt,
    state.id,
  );
}

export function getDiscoverySession(db: AppDatabase, sessionId: string): DiscoverySessionState | undefined {
  const row = db.prepare('SELECT state_json FROM work_discovery_sessions WHERE id = ?').get(sessionId) as
    | { state_json?: string }
    | undefined;
  if (!row?.state_json) return undefined;
  return JSON.parse(row.state_json) as DiscoverySessionState;
}

export function insertDiscoveryExample(
  db: AppDatabase,
  params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  },
): DiscoveryExampleRecord {
  const record: DiscoveryExampleRecord = {
    id: `ex_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    sessionId: params.sessionId,
    label: params.label,
    outputArtifactIds: params.outputArtifactIds,
    inputArtifactIds: params.inputArtifactIds,
    observationsJson: params.observationsJson ?? '[]',
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO work_discovery_examples
      (id, session_id, label, output_artifact_ids_json, input_artifact_ids_json, observations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.sessionId,
    record.label ?? null,
    JSON.stringify(record.outputArtifactIds),
    JSON.stringify(record.inputArtifactIds),
    record.observationsJson,
    record.createdAt,
  );
  return record;
}

export function listDiscoveryExamples(db: AppDatabase, sessionId: string): DiscoveryExampleRecord[] {
  const rows = db.prepare(
    'SELECT * FROM work_discovery_examples WHERE session_id = ? ORDER BY created_at ASC',
  ).all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    label: row.label ? String(row.label) : undefined,
    outputArtifactIds: JSON.parse(String(row.output_artifact_ids_json)) as string[],
    inputArtifactIds: JSON.parse(String(row.input_artifact_ids_json)) as string[],
    observationsJson: String(row.observations_json),
    createdAt: String(row.created_at),
  }));
}

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

import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import {
  DiscoverySessionStateSchema,
  type DiscoverySessionState,
} from '../../work-discovery/schema.js';

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

export interface DiscoveryReplayCaseRecord {
  id: string;
  sessionId: string;
  exampleId: string;
  snapshotSetId: string;
  expectedObservationsJson: string;
  lastResultJson?: string;
  createdAt: string;
}

function parseDiscoverySessionState(stateJson: string, sessionId: string): DiscoverySessionState {
  let raw: unknown;
  try {
    raw = JSON.parse(stateJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`work discovery session ${sessionId} state is corrupted: ${detail}`), {
      code: 'invalid_discovery_session_json',
      sessionId,
    });
  }

  const parsed = DiscoverySessionStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(`work discovery session ${sessionId} state has an invalid shape`), {
      code: 'invalid_discovery_session_state',
      sessionId,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function parseArtifactIds(raw: unknown, exampleId: string, field: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`work discovery example ${exampleId} ${field} is corrupted: ${detail}`), {
      code: 'invalid_discovery_example_json',
      exampleId,
      field,
    });
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw Object.assign(new Error(`work discovery example ${exampleId} ${field} has an invalid shape`), {
      code: 'invalid_discovery_example_artifact_ids',
      exampleId,
      field,
    });
  }
  return value;
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
  return parseDiscoverySessionState(row.state_json, sessionId);
}

export function listDiscoverySessions(db: AppDatabase): DiscoverySessionState[] {
  const rows = db.prepare(
    'SELECT id, state_json FROM work_discovery_sessions ORDER BY updated_at ASC, id ASC',
  ).all() as Array<{ id: string; state_json?: string }>;
  return rows
    .filter((row): row is { id: string; state_json: string } =>
      typeof row.state_json === 'string' && row.state_json.length > 0)
    .map((row) => parseDiscoverySessionState(row.state_json, row.id));
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
    outputArtifactIds: parseArtifactIds(row.output_artifact_ids_json, String(row.id), 'output_artifact_ids'),
    inputArtifactIds: parseArtifactIds(row.input_artifact_ids_json, String(row.id), 'input_artifact_ids'),
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

import type { AppDatabase } from '../../db.js';
import type { DiscoverySessionState } from '../../../work-discovery/schema.js';
import { parseDiscoverySessionState } from './parsing.js';

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

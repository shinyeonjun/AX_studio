import type { AppDatabase } from '../../db.js';
import { readRow, readRows } from '../../db/types.js';
import type { DiscoverySessionState } from '../../../work-discovery/schema.js';
import { mapRowsTolerant } from '../../tolerant-rows.js';
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

/**
 * Optimistic concurrency: with `expectedRevision` the write applies only if the
 * stored revision still matches; without it, a write may never move the stored
 * revision backwards (a stale state object). Throws `discovery_revision_conflict`.
 */
export function updateDiscoverySession(db: AppDatabase, state: DiscoverySessionState, expectedRevision?: number): void {
  const guard = expectedRevision === undefined ? 'revision <= ?' : 'revision = ?';
  const result = db.prepare(
    `UPDATE work_discovery_sessions
     SET status = ?, revision = ?, user_goal = ?, state_json = ?, published_workflow_id = ?, error_code = ?, error_message = ?, updated_at = ?
     WHERE id = ? AND ${guard}`,
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
    expectedRevision ?? state.revision,
  );
  if (result.changes !== 1) {
    const current = readRow<{ revision?: number }>(
      db.prepare('SELECT revision FROM work_discovery_sessions WHERE id = ?'),
      state.id,
    );
    throw Object.assign(new Error(`work discovery session ${state.id} revision conflict`), {
      code: 'discovery_revision_conflict',
      sessionId: state.id,
      attemptedRevision: state.revision,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      ...(current?.revision === undefined ? {} : { currentRevision: Number(current.revision) }),
    });
  }
}

/**
 * Records the workspace chat session that started a discovery session. The first owner
 * wins and is never reassigned, so a later caller cannot take over another chat's session.
 */
export function bindDiscoverySessionWorkspace(db: AppDatabase, sessionId: string, workspaceSessionId: string): void {
  db.prepare(
    'UPDATE work_discovery_sessions SET workspace_session_id = ? WHERE id = ? AND workspace_session_id IS NULL',
  ).run(workspaceSessionId, sessionId);
}

export function getDiscoverySessionWorkspace(db: AppDatabase, sessionId: string): string | undefined {
  const row = readRow<{ workspace_session_id?: string | null }>(
    db.prepare('SELECT workspace_session_id FROM work_discovery_sessions WHERE id = ?'),
    sessionId,
  );
  return typeof row?.workspace_session_id === 'string' && row.workspace_session_id ? row.workspace_session_id : undefined;
}

export function getDiscoverySession(db: AppDatabase, sessionId: string): DiscoverySessionState | undefined {
  const row = readRow<{ state_json?: string }>(
    db.prepare('SELECT state_json FROM work_discovery_sessions WHERE id = ?'),
    sessionId,
  );
  if (!row?.state_json) return undefined;
  return parseDiscoverySessionState(row.state_json, sessionId);
}

export function listDiscoverySessionIds(db: AppDatabase): string[] {
  return readRows<{ id: string }>(db.prepare('SELECT id FROM work_discovery_sessions')).map((row) => row.id);
}

export function listDiscoverySessions(db: AppDatabase): DiscoverySessionState[] {
  const rows = readRows<{ id: string; state_json?: string }>(db.prepare(
    'SELECT id, state_json FROM work_discovery_sessions ORDER BY updated_at ASC, id ASC',
  ));
  // One corrupt session must not stop the discovery service (constructed at startup).
  return mapRowsTolerant(db, 'work_discovery_sessions', rows, (row) => row.id, (row) => {
    if (typeof row.state_json !== 'string' || row.state_json.length === 0) {
      throw Object.assign(new Error(`work discovery session ${row.id} has no state`), {
        code: 'invalid_discovery_session_json',
        sessionId: row.id,
      });
    }
    return parseDiscoverySessionState(row.state_json, row.id);
  });
}

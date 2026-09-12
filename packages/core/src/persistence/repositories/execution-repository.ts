import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import { readRow, readRows } from '../db/types.js';
import type { ExecutionRow, ExecutionStatus } from '../rows.js';
import { hasOpenApprovalForExecution } from './approval-repository.js';
import { parseExecutionOutput, type ExecutionOutput } from '../../contracts/execution-output.js';
import { readExecutionLog } from './execution-log.js';
export { appendExecutionLog } from './execution-log.js';

export function createExecution(
  db: AppDatabase,
  params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
    workspaceSessionId?: string;
  },
): string {
  const id = randomUUID();
  db
    .prepare(
      'INSERT INTO executions (id, workflow_id, workflow_version, ephemeral, status, started_at, log_json, trigger_type, ir_json, workspace_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      params.workflowId ?? null,
      params.workflowVersion ?? null,
      params.ephemeral ? 1 : 0,
      'running',
      new Date().toISOString(),
      '[]',
      params.triggerType ?? null,
      params.irJson ?? null,
      params.workspaceSessionId ?? null,
    );
  return id;
}

export function finishExecution(
  db: AppDatabase,
  id: string,
  status: Exclude<ExecutionStatus, 'running' | 'pending_approval'>,
  errorCode?: string,
  log?: unknown[],
  output?: ExecutionOutput,
) {
  const outputJson = status === 'success' && output ? JSON.stringify(output) : null;
  if (outputJson && !parseExecutionOutput(outputJson)) throw new Error('invalid_execution_output');
  db
    .prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ?, log_json = ?, output_json = ? WHERE id = ?')
    .run(status, new Date().toISOString(), errorCode ?? null, JSON.stringify(log ?? []), outputJson, id);
}

/** Leaves the execution open so a pending approval can resume it later. */
export function markExecutionPending(
  db: AppDatabase,
  id: string,
  errorCode = 'pending_approval',
  log?: unknown[],
) {
  db
    .prepare('UPDATE executions SET status = ?, finished_at = NULL, error_code = ?, log_json = ? WHERE id = ?')
    .run('pending_approval', errorCode, JSON.stringify(log ?? []), id);
}

export function updateExecutionLog(db: AppDatabase, id: string, log: unknown[]) {
  db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run(JSON.stringify(log), id);
}

function mapExecution(db: AppDatabase, row: ExecutionRow) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    ephemeral: Boolean(row.ephemeral),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    logJson: readExecutionLog(db, row.id, row.log_json),
    output: row.status === 'success' ? parseExecutionOutput(row.output_json) : undefined,
    triggerType: row.trigger_type,
    irJson: row.ir_json ?? undefined,
    workspaceSessionId: row.workspace_session_id ?? undefined,
  };
}

export function getExecution(db: AppDatabase, id: string) {
  const row = readRow<ExecutionRow>(db.prepare('SELECT * FROM executions WHERE id = ?'), id);
  if (!row) return undefined;
  return mapExecution(db, row);
}

export function hasUnfinishedWorkflowExecution(db: AppDatabase, workflowId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM executions
    WHERE workflow_id = ? AND (status IN ('running', 'pending_approval') OR EXISTS (
      SELECT 1 FROM approvals WHERE execution_id = executions.id AND status IN ('pending', 'processing')
    )) LIMIT 1`).get(workflowId));
}

export function listExecutions(db: AppDatabase, limit = 50, includeOutput = true) {
  const rows = readRows<ExecutionRow>(
    db.prepare(`SELECT id, workflow_id, workflow_version, ephemeral, status, started_at, finished_at,
      error_code, log_json, trigger_type, ir_json, workspace_session_id,
      ${includeOutput ? 'output_json' : 'NULL AS output_json'},
      CASE WHEN status = 'success' AND output_json IS NOT NULL THEN 1 ELSE 0 END AS has_output
      FROM executions ORDER BY started_at DESC, id DESC LIMIT ?`),
    limit,
  );
  return rows.map(row => ({ ...mapExecution(db, row), hasOutput: Boolean(row.has_output) }));
}

/** Independent of the activity page limit, with one indexed lookup per saved workflow. */
export function listLatestWorkflowExecutions(db: AppDatabase) {
  return readRows<{ workflowId: string; startedAt: string; status: string }>(db.prepare(`
    SELECT e.workflow_id AS workflowId, e.started_at AS startedAt, e.status
    FROM workflows w JOIN executions e ON e.id = (
      SELECT id FROM executions WHERE workflow_id = w.id ORDER BY started_at DESC, id DESC LIMIT 1
    )`));
}

export function deleteExecution(db: AppDatabase, id: string): boolean {
  const existing = db.prepare('SELECT id, status FROM executions WHERE id = ?').get(id);
  if (!existing) return false;
  if (existing.status === 'pending_approval' || hasOpenApprovalForExecution(db, id)) {
    throw new Error('승인 대기 중인 실행은 삭제할 수 없습니다.');
  }
  if (existing.status === 'running') throw new Error('실행 중인 기록은 삭제할 수 없습니다.');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM approvals WHERE execution_id = ?').run(id);
    db.prepare('DELETE FROM executions WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return true;
}

export function clearExecutions(db: AppDatabase): number {
  const deletable = `SELECT id FROM executions
    WHERE status IN ('success', 'failed', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM approvals
        WHERE execution_id = executions.id AND status IN ('pending', 'processing')
      )`;
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM approvals WHERE execution_id IN (${deletable})`).run();
    const result = db.prepare(`DELETE FROM executions WHERE id IN (${deletable})`).run();
    db.exec('COMMIT');
    return result.changes;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

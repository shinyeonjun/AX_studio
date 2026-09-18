import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import { readRow, readRows } from '../db/types.js';
import type { ExecutionRow, ExecutionStatus } from '../rows.js';
import { hasOpenApprovalForExecution } from './approval-repository.js';

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
) {
  db
    .prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ?, log_json = ? WHERE id = ?')
    .run(status, new Date().toISOString(), errorCode ?? null, JSON.stringify(log ?? []), id);
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

export function hasPendingApprovalForWorkflow(db: AppDatabase, workflowId: string): boolean {
  const row = readRow<{ found: number }>(db.prepare(
    `SELECT 1 AS found
     FROM executions
     WHERE workflow_id = ? AND status = 'pending_approval'
     LIMIT 1`,
  ), workflowId);
  return Boolean(row?.found);
}

function mapExecution(row: ExecutionRow) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    ephemeral: Boolean(row.ephemeral),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    logJson: row.log_json,
    triggerType: row.trigger_type,
    irJson: row.ir_json ?? undefined,
    workspaceSessionId: row.workspace_session_id ?? undefined,
  };
}

export function getExecution(db: AppDatabase, id: string) {
  const row = readRow<ExecutionRow>(db.prepare('SELECT * FROM executions WHERE id = ?'), id);
  if (!row) return undefined;
  return mapExecution(row);
}

export function listExecutions(db: AppDatabase, limit = 50) {
  const rows = readRows<ExecutionRow>(
    db.prepare('SELECT * FROM executions ORDER BY started_at DESC LIMIT ?'),
    limit,
  );
  return rows.map(mapExecution);
}

export function deleteExecution(db: AppDatabase, id: string): boolean {
  const existing = readRow<{ id: string; status: ExecutionStatus }>(
    db.prepare('SELECT id, status FROM executions WHERE id = ?'),
    id,
  );
  if (!existing) return false;
  if (hasOpenApprovalForExecution(db, id)) {
    throw new Error('승인 대기 중인 실행은 삭제할 수 없습니다.');
  }
  if (existing.status === 'running' || existing.status === 'pending_approval') {
    throw Object.assign(new Error('실행 중인 실행은 삭제할 수 없습니다.'), { code: 'execution_active' });
  }
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
  db.exec('BEGIN');
  try {
    const terminalStatuses = "('success', 'failed', 'cancelled')";
    const countRow = readRow<{ count: number }>(
      db.prepare(`SELECT COUNT(*) AS count FROM executions WHERE status IN ${terminalStatuses}`),
    )!;
    db.prepare(
      `DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions WHERE status IN ${terminalStatuses})`,
    ).run();
    db.prepare(`DELETE FROM executions WHERE status IN ${terminalStatuses}`).run();
    db.exec('COMMIT');
    return countRow.count;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

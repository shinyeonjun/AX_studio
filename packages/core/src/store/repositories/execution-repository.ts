import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
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
  },
): string {
  const id = randomUUID();
  db
    .prepare(
      'INSERT INTO executions (id, workflow_id, workflow_version, ephemeral, status, started_at, log_json, trigger_type, ir_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
  };
}

export function getExecution(db: AppDatabase, id: string) {
  const row = db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as ExecutionRow | undefined;
  if (!row) return undefined;
  return mapExecution(row);
}

export function listExecutions(db: AppDatabase, limit = 50) {
  const rows = db
    .prepare('SELECT * FROM executions ORDER BY started_at DESC LIMIT ?')
    .all(limit) as unknown as ExecutionRow[];
  return rows.map(mapExecution);
}

export function deleteExecution(db: AppDatabase, id: string): boolean {
  const existing = db.prepare('SELECT id FROM executions WHERE id = ?').get(id);
  if (!existing) return false;
  if (hasOpenApprovalForExecution(db, id)) {
    throw new Error('승인 대기 중인 실행은 삭제할 수 없습니다.');
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
  const pendingExecutionIds = (
    db.prepare("SELECT execution_id FROM approvals WHERE status IN ('pending', 'processing')").all() as Array<{
      execution_id: string;
    }>
  ).map((row) => row.execution_id);

  db.exec('BEGIN');
  try {
    if (pendingExecutionIds.length === 0) {
      const countRow = db.prepare('SELECT COUNT(*) AS count FROM executions').get() as { count: number };
      db.prepare('DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions)').run();
      db.prepare('DELETE FROM executions').run();
      db.exec('COMMIT');
      return countRow.count;
    }

    const placeholders = pendingExecutionIds.map(() => '?').join(', ');
    const countRow = db
      .prepare(`SELECT COUNT(*) AS count FROM executions WHERE id NOT IN (${placeholders})`)
      .get(...pendingExecutionIds) as { count: number };

    db
      .prepare(
        `DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions WHERE id NOT IN (${placeholders}))`,
      )
      .run(...pendingExecutionIds);
    db.prepare(`DELETE FROM executions WHERE id NOT IN (${placeholders})`).run(...pendingExecutionIds);
    db.exec('COMMIT');
    return countRow.count;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

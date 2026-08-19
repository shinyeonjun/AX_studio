import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { ExecutionRow } from '../rows.js';
import { hasPendingApprovalForExecution } from './approval-repository.js';

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
  status: 'success' | 'failed' | 'cancelled',
  errorCode?: string,
  log?: unknown[],
) {
  db
    .prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ?, log_json = ? WHERE id = ?')
    .run(status, new Date().toISOString(), errorCode ?? null, JSON.stringify(log ?? []), id);
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
  if (hasPendingApprovalForExecution(db, id)) {
    throw new Error('승인 대기 중인 실행은 삭제할 수 없습니다.');
  }
  db.prepare('DELETE FROM approvals WHERE execution_id = ?').run(id);
  db.prepare('DELETE FROM executions WHERE id = ?').run(id);
  return true;
}

export function clearExecutions(db: AppDatabase): number {
  const pendingExecutionIds = (
    db.prepare('SELECT execution_id FROM approvals WHERE status = ?').all('pending') as Array<{
      execution_id: string;
    }>
  ).map((row) => row.execution_id);

  if (pendingExecutionIds.length === 0) {
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM executions').get() as { count: number };
    db.prepare('DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions)').run();
    db.prepare('DELETE FROM executions').run();
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
  return countRow.count;
}

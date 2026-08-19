import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { ApprovalRow } from '../rows.js';

export function createApproval(
  db: AppDatabase,
  params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown },
): string {
  const id = randomUUID();
  db
    .prepare(
      'INSERT INTO approvals (id, execution_id, action_ids_json, reason, status, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      params.executionId,
      JSON.stringify(params.actionIds),
      params.reason,
      'pending',
      new Date().toISOString(),
      params.payload ? JSON.stringify(params.payload) : null,
    );
  return id;
}

export function updateApprovalPayload(db: AppDatabase, id: string, extra: Record<string, unknown>) {
  const current = getApproval(db, id);
  if (!current) return;
  const payload =
    current.payload && typeof current.payload === 'object'
      ? { ...(current.payload as Record<string, unknown>), ...extra }
      : extra;
  db.prepare('UPDATE approvals SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), id);
}

export function resolveApproval(db: AppDatabase, id: string, approved: boolean) {
  db
    .prepare('UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?')
    .run(approved ? 'approved' : 'rejected', new Date().toISOString(), id);
}

export function getApproval(db: AppDatabase, id: string) {
  const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    executionId: row.execution_id,
    actionIds: JSON.parse(row.action_ids_json) as string[],
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
  };
}

export function getPendingApprovals(db: AppDatabase) {
  const rows = db
    .prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC')
    .all('pending') as unknown as ApprovalRow[];
  return rows.map((row) => ({
    id: row.id,
    executionId: row.execution_id,
    actionIds: JSON.parse(row.action_ids_json) as string[],
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
  }));
}

export function hasPendingApprovalForExecution(db: AppDatabase, executionId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM approvals WHERE execution_id = ? AND status = ? LIMIT 1')
    .get(executionId, 'pending') as { found: number } | undefined;
  return Boolean(row?.found);
}

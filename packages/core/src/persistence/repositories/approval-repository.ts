import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import { readRow, readRows } from '../db/types.js';
import type { ApprovalRow } from '../rows.js';

function parseApprovalJson<T>(raw: string, field: string, approvalId: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`승인 ${approvalId}의 ${field} JSON이 손상되었습니다: ${detail}`), {
      code: 'invalid_approval_json',
      approvalId,
      field,
    });
  }
}

function parseActionIds(raw: string, approvalId: string): string[] {
  const value = parseApprovalJson<unknown>(raw, 'action_ids', approvalId);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw Object.assign(new Error(`승인 ${approvalId}의 action_ids 형식이 올바르지 않습니다.`), {
      code: 'invalid_approval_json',
      approvalId,
      field: 'action_ids',
    });
  }
  return value;
}

function parsePayload(raw: string | null, approvalId: string): unknown {
  if (!raw) return undefined;
  return parseApprovalJson(raw, 'payload', approvalId);
}

function mapApproval(row: ApprovalRow) {
  return {
    id: row.id,
    executionId: row.execution_id,
    actionIds: parseActionIds(row.action_ids_json, row.id),
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    payload: parsePayload(row.payload_json, row.id),
  };
}

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
      params.payload === undefined ? null : JSON.stringify(params.payload),
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
    .prepare("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status IN ('pending', 'processing')")
    .run(approved ? 'approved' : 'rejected', new Date().toISOString(), id);
}

/** Rejects only a still-pending UI approval; a claimed approval belongs to its runner. */
export function rejectPendingApproval(db: AppDatabase, id: string): boolean {
  const result = db
    .prepare("UPDATE approvals SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = 'pending'")
    .run(new Date().toISOString(), id);
  return result.changes === 1;
}

/** Closes a claimed approval when its execution can no longer be resumed. */
export function failApproval(db: AppDatabase, id: string): boolean {
  const result = db
    .prepare("UPDATE approvals SET status = 'failed', resolved_at = ? WHERE id = ? AND status = 'processing'")
    .run(new Date().toISOString(), id);
  return result.changes === 1;
}

/** Atomically reserves a pending approval so two UI clicks cannot resume it twice. */
export function claimApproval(db: AppDatabase, id: string): boolean {
  const result = db
    .prepare("UPDATE approvals SET status = 'processing' WHERE id = ? AND status = 'pending'")
    .run(id);
  return result.changes === 1;
}

export function getApproval(db: AppDatabase, id: string) {
  const row = readRow<ApprovalRow>(db.prepare('SELECT * FROM approvals WHERE id = ?'), id);
  if (!row) return undefined;
  return mapApproval(row);
}

export function getPendingApprovals(db: AppDatabase) {
  const rows = readRows<ApprovalRow>(
    db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC'),
    'pending',
  );
  return rows.map(mapApproval);
}

export function getPendingApprovalsWithExecutionSnapshots(db: AppDatabase) {
  const rows = readRows<ApprovalRow & { execution_ir_json: string | null }>(db.prepare(
    `SELECT a.*, e.ir_json AS execution_ir_json
     FROM approvals a
     LEFT JOIN executions e ON e.id = a.execution_id
     WHERE a.status = ?
     ORDER BY a.created_at DESC`,
  ), 'pending');
  return rows.map((row) => ({
    approval: mapApproval(row),
    executionIrJson: row.execution_ir_json ?? undefined,
  }));
}

export function hasPendingApprovalForExecution(db: AppDatabase, executionId: string): boolean {
  return hasOpenApprovalForExecution(db, executionId);
}

export function hasOpenApprovalForExecution(db: AppDatabase, executionId: string): boolean {
  const row = readRow<{ found: number }>(
    db.prepare("SELECT 1 AS found FROM approvals WHERE execution_id = ? AND status IN ('pending', 'processing') LIMIT 1"),
    executionId,
  );
  return Boolean(row?.found);
}

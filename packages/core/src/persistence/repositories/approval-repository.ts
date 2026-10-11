import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import { persistDatabase, readRow, readRows } from '../db/types.js';
import type { ToolSendOutcome } from '../../contracts/tool-result.js';
import type { ApprovalRow } from '../rows.js';
import { mapRowsTolerant } from '../tolerant-rows.js';
import { approvalSources, approvalTarget, type ApprovalTransition } from '../../domain/approval-state.js';

/** `?, ?` placeholders for an IN list, so the SQL is built from the domain's source states. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

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

function mapApprovals(db: AppDatabase, rows: ApprovalRow[]) {
  return mapRowsTolerant(db, 'approvals', rows, (row) => row.id, mapApproval);
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
  persistDatabase(db);
}

export function resolveApproval(db: AppDatabase, id: string, approved: boolean) {
  const transition: ApprovalTransition = approved ? 'approve' : 'reject';
  const sources = approvalSources(transition);
  db
    .prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status IN (${placeholders(sources.length)})`)
    .run(approvalTarget(transition), new Date().toISOString(), id, ...sources);
  persistDatabase(db);
}

/** Rejects only a still-pending UI approval; a claimed approval belongs to its runner. */
export function rejectPendingApproval(db: AppDatabase, id: string): boolean {
  const current = readRow<{ status: string; resolved_at: string | null }>(db.prepare('SELECT status, resolved_at FROM approvals WHERE id = ?'), id);
  if (current?.status !== 'pending') return false;
  const sources = approvalSources('reject_pending');
  const result = db
    .prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status IN (${placeholders(sources.length)})`)
    .run(approvalTarget('reject_pending'), new Date().toISOString(), id, ...sources);
  if (result.changes !== 1) return false;
  try { persistDatabase(db); }
  catch (error) {
    const reopen = approvalSources('reopen');
    db.prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status IN (${placeholders(reopen.length)})`)
      .run(approvalTarget('reopen'), current.resolved_at, id, ...reopen);
    throw error;
  }
  return true;
}

/** Closes a claimed approval when its execution can no longer be resumed. */
export function failApproval(db: AppDatabase, id: string): boolean {
  const sources = approvalSources('fail');
  const result = db
    .prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status IN (${placeholders(sources.length)})`)
    .run(approvalTarget('fail'), new Date().toISOString(), id, ...sources);
  if (result.changes === 1) persistDatabase(db);
  return result.changes === 1;
}

/** Atomically reserves a pending approval so two UI clicks cannot resume it twice. */
export function claimApproval(db: AppDatabase, id: string, intent?: Pick<ToolSendOutcome, 'binding' | 'paramsHash'>): boolean {
  const current = getApproval(db, id);
  if (!current || current.status !== 'pending') return false;
  const originalPayload = current.payload === undefined ? null : JSON.stringify(current.payload);
  const payload = intent ? { ...(current.payload && typeof current.payload === 'object' ? current.payload : {}), toolSendIntent: intent } : current.payload;
  const sources = approvalSources('claim');
  const result = db
    .prepare(`UPDATE approvals SET status = ?, payload_json = ? WHERE id = ? AND status IN (${placeholders(sources.length)})`)
    .run(approvalTarget('claim'), payload === undefined ? null : JSON.stringify(payload), id, ...sources);
  if (result.changes !== 1) return false;
  try { persistDatabase(db); }
  catch (error) {
    // No provider has been called. Restore the editable in-process state; require a new seal.
    const release = approvalSources('release');
    db.prepare(`UPDATE approvals SET status = ?, payload_json = ? WHERE id = ? AND status IN (${placeholders(release.length)})`)
      .run(approvalTarget('release'), originalPayload, id, ...release);
    throw error;
  }
  return true;
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
  return mapApprovals(db, rows);
}

export function getProcessingApprovals(db: AppDatabase) {
  return mapApprovals(db, readRows<ApprovalRow>(db.prepare('SELECT * FROM approvals WHERE status = ?'), 'processing'));
}

/** Durable checkpoints whose paired execution may need restart reconciliation. */
export function getApprovalRecoveryCandidates(db: AppDatabase) {
  return mapApprovals(db, readRows<ApprovalRow>(db.prepare(
    `SELECT a.* FROM approvals a
     JOIN executions e ON e.id = a.execution_id
     WHERE a.status = 'processing'
        OR (a.status IN ('pending', 'approved', 'rejected', 'failed')
            AND e.status IN ('running', 'pending_approval'))`,
  )));
}

export function getPendingApprovalsWithExecutionSnapshots(db: AppDatabase) {
  const rows = readRows<ApprovalRow & { execution_ir_json: string | null }>(db.prepare(
    `SELECT a.*, e.ir_json AS execution_ir_json
     FROM approvals a
     LEFT JOIN executions e ON e.id = a.execution_id
     WHERE a.status = ?
     ORDER BY a.created_at DESC`,
  ), 'pending');
  return mapRowsTolerant(db, 'approvals', rows, (row) => row.id, (row) => ({
    approval: mapApproval(row),
    executionIrJson: row.execution_ir_json ?? undefined,
  }));
}

export function hasOpenApprovalForExecution(db: AppDatabase, executionId: string): boolean {
  const row = readRow<{ found: number }>(
    db.prepare("SELECT 1 AS found FROM approvals WHERE execution_id = ? AND status IN ('pending', 'processing') LIMIT 1"),
    executionId,
  );
  return Boolean(row?.found);
}

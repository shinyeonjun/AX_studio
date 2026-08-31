import type { AppDatabase } from '../db.js';

export type TriggerReceiptStatus = 'processing' | 'completed' | 'failed';

/**
 * A receipt left in processing beyond this window may belong to a crashed
 * worker. The window is deliberately long enough to avoid reclaiming normal
 * workflow executions while still allowing restart recovery.
 */
export const DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS = 15 * 60 * 1_000;

export function claimTriggerReceipt(
  db: AppDatabase,
  params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  },
): boolean {
  const now = new Date().toISOString();
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO trigger_receipts
       (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at)
       VALUES (?, ?, ?, 'processing', ?, ?)`,
    )
    .run(params.dedupeKey, params.workflowId, params.triggerType, now, now);
  if (inserted.changes > 0) return true;

  const existing = db
    .prepare('SELECT status, updated_at FROM trigger_receipts WHERE dedupe_key = ?')
    .get(params.dedupeKey) as { status?: string; updated_at?: string | null } | undefined;
  if (!existing) return false;
  if (existing.status === 'completed') return false;

  if (existing.status === 'failed') {
    const retried = db
      .prepare(
        `UPDATE trigger_receipts
         SET status = 'processing', updated_at = ?
         WHERE dedupe_key = ? AND status = 'failed'`,
      )
      .run(now, params.dedupeKey);
    return retried.changes > 0;
  }

  if (existing.status === 'processing') {
    const updatedAt = Date.parse(String(existing.updated_at ?? ''));
    const leaseMs =
      typeof params.processingLeaseMs === 'number' &&
      Number.isFinite(params.processingLeaseMs) &&
      params.processingLeaseMs > 0
        ? params.processingLeaseMs
        : DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS;
    if (!Number.isFinite(updatedAt) || updatedAt > Date.now() - leaseMs) return false;

    const reclaimed = db
      .prepare(
        `UPDATE trigger_receipts
         SET status = 'processing', execution_id = NULL, updated_at = ?
         WHERE dedupe_key = ? AND status = 'processing' AND updated_at = ?`,
      )
      .run(now, params.dedupeKey, existing.updated_at ?? null);
    return reclaimed.changes > 0;
  }

  return false;
}

export function completeTriggerReceipt(
  db: AppDatabase,
  dedupeKey: string,
  executionId?: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE trigger_receipts
     SET status = 'completed', execution_id = ?, updated_at = ?
     WHERE dedupe_key = ?`,
  ).run(executionId ?? null, now, dedupeKey);
}

export function failTriggerReceipt(db: AppDatabase, dedupeKey: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE trigger_receipts
     SET status = 'failed', updated_at = ?
     WHERE dedupe_key = ?`,
  ).run(now, dedupeKey);
}

export function isTriggerReceiptCompleted(db: AppDatabase, dedupeKey: string): boolean {
  const row = db
    .prepare('SELECT status FROM trigger_receipts WHERE dedupe_key = ?')
    .get(dedupeKey) as { status?: string } | undefined;
  return row?.status === 'completed';
}

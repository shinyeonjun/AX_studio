import type { AppDatabase } from '../db.js';
import { readRow } from '../db/types.js';
import { decideTriggerClaim, type TriggerReceiptStatus } from '../../domain/trigger-receipt-state.js';

export { DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS } from '../../domain/trigger-receipt-state.js';

export type { TriggerReceiptStatus };

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

  const existing = readRow<{ status?: string; updated_at?: string | null }>(
    db.prepare('SELECT status, updated_at FROM trigger_receipts WHERE dedupe_key = ?'),
    params.dedupeKey,
  );
  if (!existing) return false;
  const decision = decideTriggerClaim({
    stored: existing.status === undefined ? undefined : { status: existing.status as TriggerReceiptStatus, updatedAt: existing.updated_at },
    now: Date.now(),
    leaseMs: params.processingLeaseMs,
  });
  if (decision === 'retry_failed') {
    const retried = db
      .prepare(
        `UPDATE trigger_receipts
         SET status = 'processing', updated_at = ?
         WHERE dedupe_key = ? AND status = 'failed'`,
      )
      .run(now, params.dedupeKey);
    return retried.changes > 0;
  }
  if (decision === 'reclaim_lease') {
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
  const row = readRow<{ status?: string }>(
    db.prepare('SELECT status FROM trigger_receipts WHERE dedupe_key = ?'),
    dedupeKey,
  );
  return row?.status === 'completed';
}

/**
 * Terminal dead-letter state. claimTriggerReceipt never reclaims a dead
 * receipt, so the event is neither retried nor allowed to block later events.
 */
export function deadLetterTriggerReceipt(db: AppDatabase, dedupeKey: string, executionId?: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE trigger_receipts
     SET status = 'dead', execution_id = COALESCE(?, execution_id), updated_at = ?
     WHERE dedupe_key = ?`,
  ).run(executionId ?? null, now, dedupeKey);
}

/** Startup only: a processing receipt has no live owner after restart; never auto-retry it. */
export function deadLetterProcessingTriggerReceipts(db: AppDatabase): number {
  const now = new Date().toISOString();
  return db.prepare(
    `UPDATE trigger_receipts SET status = 'dead', updated_at = ? WHERE status = 'processing'`,
  ).run(now).changes;
}

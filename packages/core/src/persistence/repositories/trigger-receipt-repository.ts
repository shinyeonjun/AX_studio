import type { AppDatabase } from '../db.js';
import { readRow } from '../db/types.js';
import {
  decideTriggerClaim,
  TRIGGER_RECEIPT_FINISH_FROM,
  type TriggerReceiptFinish,
  type TriggerReceiptStatus,
} from '../../domain/trigger-receipt-state.js';



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

/** Finishes a receipt only from a status the domain allows (see TRIGGER_RECEIPT_FINISH_FROM). */
function finishTriggerReceipt(
  db: AppDatabase,
  finish: TriggerReceiptFinish,
  dedupeKey: string,
  columns: { status: TriggerReceiptStatus; executionId?: string | null },
): boolean {
  const now = new Date().toISOString();
  const from = TRIGGER_RECEIPT_FINISH_FROM[finish];
  const executionClause = columns.executionId === undefined ? '' : ', execution_id = COALESCE(?, execution_id)';
  const params: Array<string | null> = [columns.status];
  if (columns.executionId !== undefined) params.push(columns.executionId);
  params.push(now, dedupeKey, ...from);
  const changed = db
    .prepare(
      `UPDATE trigger_receipts
       SET status = ?${executionClause}, updated_at = ?
       WHERE dedupe_key = ? AND status IN (${from.map(() => '?').join(', ')})`,
    )
    .run(...params).changes;
  return changed > 0;
}

export function completeTriggerReceipt(
  db: AppDatabase,
  dedupeKey: string,
  executionId?: string,
): boolean {
  return finishTriggerReceipt(db, 'completed', dedupeKey, { status: 'completed', executionId: executionId ?? null });
}

export function failTriggerReceipt(db: AppDatabase, dedupeKey: string): boolean {
  return finishTriggerReceipt(db, 'failed', dedupeKey, { status: 'failed' });
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
export function deadLetterTriggerReceipt(db: AppDatabase, dedupeKey: string, executionId?: string): boolean {
  return finishTriggerReceipt(db, 'dead', dedupeKey, { status: 'dead', executionId: executionId ?? null });
}

/** Startup only: a processing receipt has no live owner after restart; never auto-retry it. */
export function deadLetterProcessingTriggerReceipts(db: AppDatabase): number {
  const now = new Date().toISOString();
  return db.prepare(
    `UPDATE trigger_receipts SET status = 'dead', updated_at = ? WHERE status = 'processing'`,
  ).run(now).changes;
}

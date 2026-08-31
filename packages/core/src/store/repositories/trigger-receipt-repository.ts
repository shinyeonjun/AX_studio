import type { AppDatabase } from '../db.js';

export type TriggerReceiptStatus = 'processing' | 'completed' | 'failed';

export function claimTriggerReceipt(
  db: AppDatabase,
  params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
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

  const retried = db.prepare(
    `UPDATE trigger_receipts
     SET status = 'processing', updated_at = ?
     WHERE dedupe_key = ? AND status = 'failed'`,
  ).run(now, params.dedupeKey);
  return retried.changes > 0;
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

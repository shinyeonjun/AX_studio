/**
 * Trigger receipt rules: how one event is claimed, finished, or given up. Pure: the caller
 * supplies the stored status, the stored timestamp and the current time. Persistence still
 * performs each change as a conditional write, so two workers cannot both win a claim.
 */

export const TRIGGER_RECEIPT_STATUSES = ['processing', 'completed', 'failed', 'dead'] as const;
export type TriggerReceiptStatus = (typeof TRIGGER_RECEIPT_STATUSES)[number];

/** A receipt left in processing longer than this may belong to a crashed worker. */
export const DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS = 15 * 60 * 1_000;

export type ClaimDecision =
  /** No receipt yet: insert one in processing. */
  | 'insert'
  /** A failed event is retried: failed → processing. */
  | 'retry_failed'
  /** A processing receipt's lease expired: take it over, guarded by its old timestamp. */
  | 'reclaim_lease'
  /** Someone else owns it, it is finished, or it is dead. Do not run. */
  | 'refuse';

export function decideTriggerClaim(input: {
  stored: { status: TriggerReceiptStatus; updatedAt: string | null | undefined } | undefined;
  now: number;
  leaseMs?: number;
}): ClaimDecision {
  if (!input.stored) return 'insert';
  if (input.stored.status === 'failed') return 'retry_failed';
  if (input.stored.status !== 'processing') return 'refuse';
  const updatedAt = Date.parse(String(input.stored.updatedAt ?? ''));
  const leaseMs = typeof input.leaseMs === 'number' && Number.isFinite(input.leaseMs) && input.leaseMs > 0
    ? input.leaseMs
    : DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS;
  if (!Number.isFinite(updatedAt) || updatedAt > input.now - leaseMs) return 'refuse';
  return 'reclaim_lease';
}

// Finishing a receipt (completed, failed, dead) is not checked against its status here. The
// writes are unconditional today; tightening them is a separate change with its own tests.

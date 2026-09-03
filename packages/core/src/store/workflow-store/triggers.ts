import type { AppDatabase } from '../db.js';
import * as triggerReceiptRepo from '../repositories/trigger-receipt-repository.js';

export function claimTriggerReceipt(
  db: AppDatabase,
  params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  },
) {
  return triggerReceiptRepo.claimTriggerReceipt(db, params);
}

export function completeTriggerReceipt(db: AppDatabase, dedupeKey: string, executionId?: string) {
  triggerReceiptRepo.completeTriggerReceipt(db, dedupeKey, executionId);
}

export function failTriggerReceipt(db: AppDatabase, dedupeKey: string) {
  triggerReceiptRepo.failTriggerReceipt(db, dedupeKey);
}

export function isTriggerReceiptCompleted(db: AppDatabase, dedupeKey: string) {
  return triggerReceiptRepo.isTriggerReceiptCompleted(db, dedupeKey);
}

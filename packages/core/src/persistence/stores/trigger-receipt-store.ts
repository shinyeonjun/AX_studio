import type { AppDatabase } from '../db.js';
import * as triggerReceiptRepo from '../repositories/trigger-receipt-repository.js';

export class TriggerReceiptStore {
  /**
   * Receipts this process claimed and has not settled. The processing lease only exists to recover
   * work a dead process left behind; a run still in progress here (a long run, or one waiting in the
   * run queue) must never be reclaimed by the poll path and run a second time.
   */
  private readonly receiptsInProgress = new Set<string>();

  constructor(private readonly db: AppDatabase) {}

  claimTriggerReceipt(params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  }) {
    if (this.receiptsInProgress.has(params.dedupeKey)) return false;
    const claimed = triggerReceiptRepo.claimTriggerReceipt(this.db, params);
    if (claimed) this.receiptsInProgress.add(params.dedupeKey);
    return claimed;
  }
  completeTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggerReceiptRepo.completeTriggerReceipt(this.db, dedupeKey, executionId);
    this.receiptsInProgress.delete(dedupeKey);
  }
  failTriggerReceipt(dedupeKey: string) {
    triggerReceiptRepo.failTriggerReceipt(this.db, dedupeKey);
    this.receiptsInProgress.delete(dedupeKey);
  }
  deadLetterTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggerReceiptRepo.deadLetterTriggerReceipt(this.db, dedupeKey, executionId);
    this.receiptsInProgress.delete(dedupeKey);
  }
  deadLetterProcessingTriggerReceipts() { return triggerReceiptRepo.deadLetterProcessingTriggerReceipts(this.db); }
  isTriggerReceiptCompleted(dedupeKey: string) {
    return triggerReceiptRepo.isTriggerReceiptCompleted(this.db, dedupeKey);
  }
}

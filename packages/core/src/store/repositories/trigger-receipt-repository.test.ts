import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import {
  claimTriggerReceipt,
  completeTriggerReceipt,
  failTriggerReceipt,
} from './trigger-receipt-repository.js';

const receipt = {
  dedupeKey: 'workflow-1:event-1',
  workflowId: 'workflow-1',
  triggerType: 'gmail.new_message',
};

describe('trigger receipt repository', () => {
  it('atomically reclaims only a failed receipt', async () => {
    const db = await createDatabaseAsync(':memory:');

    expect(claimTriggerReceipt(db, receipt)).toBe(true);
    expect(claimTriggerReceipt(db, receipt)).toBe(false);

    failTriggerReceipt(db, receipt.dedupeKey);
    expect(claimTriggerReceipt(db, receipt)).toBe(true);
    expect(claimTriggerReceipt(db, receipt)).toBe(false);

    completeTriggerReceipt(db, receipt.dedupeKey, 'execution-1');
    expect(claimTriggerReceipt(db, receipt)).toBe(false);
  });

  it('does not reclaim a receipt with an unknown persisted status', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO trigger_receipts
       (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(receipt.dedupeKey, receipt.workflowId, receipt.triggerType, 'corrupted', now, now);

    expect(claimTriggerReceipt(db, receipt)).toBe(false);
  });
});

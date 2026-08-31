import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
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
  const databases: Array<{ close?: () => void }> = [];

  afterEach(() => {
    for (const database of databases) database.close?.();
    databases.length = 0;
  });

  it('atomically reclaims only a failed receipt', async () => {
    const db = await createDatabaseAsync(':memory:');
    databases.push(db);

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
    databases.push(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO trigger_receipts
       (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(receipt.dedupeKey, receipt.workflowId, receipt.triggerType, 'corrupted', now, now);

    expect(claimTriggerReceipt(db, receipt)).toBe(false);
  });

  it('reclaims only stale processing receipts and keeps fresh/completed receipts deduplicated', async () => {
    const db = await createDatabaseAsync(':memory:');
    databases.push(db);
    const store = new WorkflowStore(db);

    const fresh = { dedupeKey: 'fresh-event', workflowId: 'workflow-1', triggerType: 'webhook.inbound' };
    expect(store.claimTriggerReceipt({ ...fresh, processingLeaseMs: 1_000 })).toBe(true);
    expect(store.claimTriggerReceipt({ ...fresh, processingLeaseMs: 1_000 })).toBe(false);

    store.completeTriggerReceipt(fresh.dedupeKey, 'execution-1');
    expect(store.claimTriggerReceipt({ ...fresh, processingLeaseMs: 1_000 })).toBe(false);

    const staleAt = new Date(Date.now() - 10_000).toISOString();
    db
      .prepare(
        `INSERT INTO trigger_receipts
         (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at)
         VALUES (?, ?, ?, 'processing', ?, ?)`,
      )
      .run('stale-event', 'workflow-1', 'webhook.inbound', staleAt, staleAt);

    const stale = { dedupeKey: 'stale-event', workflowId: 'workflow-1', triggerType: 'webhook.inbound' };
    expect(store.claimTriggerReceipt({ ...stale, processingLeaseMs: 1_000 })).toBe(true);
    expect(store.claimTriggerReceipt({ ...stale, processingLeaseMs: 1_000 })).toBe(false);
  });
});

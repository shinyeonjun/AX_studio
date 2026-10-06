import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from './db.js';
import { WorkflowStore } from './workflow-store.js';

describe('a trigger receipt still being processed here', () => {
  it('is not reclaimed after its lease, so a long run never runs twice', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
      const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
      const receipt = { dedupeKey: 'wf:slack.new_message:C1:1.0', workflowId: 'wf', triggerType: 'slack.new_message', processingLeaseMs: 15 * 60_000 };
      expect(store.claimTriggerReceipt(receipt)).toBe(true);
      // The push run is still going 20 minutes later when the poll fallback sees the same message.
      vi.setSystemTime(new Date('2026-10-07T00:20:00Z'));
      expect(store.claimTriggerReceipt(receipt)).toBe(false);
      store.completeTriggerReceipt(receipt.dedupeKey, 'exec-1');
      expect(store.claimTriggerReceipt(receipt)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be retried once its failed run has settled', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const receipt = { dedupeKey: 'wf:webhook:1', workflowId: 'wf', triggerType: 'webhook.inbound' };
    expect(store.claimTriggerReceipt(receipt)).toBe(true);
    store.failTriggerReceipt(receipt.dedupeKey);
    expect(store.claimTriggerReceipt(receipt)).toBe(true);
  });

  it('left behind by a previous process can still be recovered after its lease', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
      const db = await createDatabaseAsync(':memory:');
      const receipt = { dedupeKey: 'wf:file:a', workflowId: 'wf', triggerType: 'local_folder.new_file', processingLeaseMs: 60_000 };
      expect(new WorkflowStore(db).claimTriggerReceipt(receipt)).toBe(true);
      vi.setSystemTime(new Date('2026-10-07T00:05:00Z'));
      expect(new WorkflowStore(db).claimTriggerReceipt(receipt)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

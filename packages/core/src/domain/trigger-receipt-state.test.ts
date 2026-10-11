import { describe, expect, it } from 'vitest';
import { canFinishTriggerReceipt, decideTriggerClaim, DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS } from './trigger-receipt-state.js';

const NOW = Date.parse('2026-10-11T00:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('trigger receipt claim', () => {
  it('inserts when the event has never been seen', () => {
    expect(decideTriggerClaim({ stored: undefined, now: NOW })).toBe('insert');
  });

  it('retries a failed event', () => {
    expect(decideTriggerClaim({ stored: { status: 'failed', updatedAt: minutesAgo(1) }, now: NOW })).toBe('retry_failed');
  });

  it('refuses an event that completed or was dead-lettered', () => {
    expect(decideTriggerClaim({ stored: { status: 'completed', updatedAt: minutesAgo(999) }, now: NOW })).toBe('refuse');
    expect(decideTriggerClaim({ stored: { status: 'dead', updatedAt: minutesAgo(999) }, now: NOW })).toBe('refuse');
  });

  it('refuses a processing receipt whose lease is still live', () => {
    expect(decideTriggerClaim({ stored: { status: 'processing', updatedAt: minutesAgo(1) }, now: NOW })).toBe('refuse');
  });

  it('takes over a processing receipt only after its lease expired', () => {
    const expired = { status: 'processing' as const, updatedAt: minutesAgo(16) };
    expect(decideTriggerClaim({ stored: expired, now: NOW, leaseMs: DEFAULT_TRIGGER_RECEIPT_PROCESSING_LEASE_MS })).toBe('reclaim_lease');
  });

  it('honours a caller lease and refuses a receipt with no usable timestamp', () => {
    expect(decideTriggerClaim({ stored: { status: 'processing', updatedAt: minutesAgo(2) }, now: NOW, leaseMs: 60_000 })).toBe('reclaim_lease');
    expect(decideTriggerClaim({ stored: { status: 'processing', updatedAt: null }, now: NOW })).toBe('refuse');
  });
});

describe('trigger receipt finish', () => {
  it('lets only the owner of a processing receipt finish it', () => {
    expect(canFinishTriggerReceipt('processing', 'completed')).toBe(true);
    expect(canFinishTriggerReceipt('processing', 'failed')).toBe(true);
    expect(canFinishTriggerReceipt('processing', 'dead')).toBe(true);
  });

  it('never moves a completed or dead receipt', () => {
    for (const finish of ['completed', 'failed', 'dead'] as const) {
      expect(canFinishTriggerReceipt('completed', finish)).toBe(false);
      expect(canFinishTriggerReceipt('dead', finish)).toBe(false);
    }
  });

  it('does not finish a failed receipt or one that was never claimed', () => {
    expect(canFinishTriggerReceipt('failed', 'completed')).toBe(false);
    expect(canFinishTriggerReceipt('failed', 'dead')).toBe(false);
    expect(canFinishTriggerReceipt(undefined, 'completed')).toBe(false);
  });
});

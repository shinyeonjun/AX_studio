import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { WorkflowRuntime } from '../engine.js';
import { Scheduler } from './service.js';

// Produced by actual b595 Store/Runtime/Scheduler: midnight pending, deletion,
// then same-ID/version/trigger recreation. The legacy pending survived deletion.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy-b595-pending.json', import.meta.url), 'utf8')) as {
  generatedWith: string; generationChangedDuringBaselineRecreation: boolean;
  pending: Array<Record<string, unknown>>; lastObservedAt: string; freshWorkflow: WorkflowIR;
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function setup(proven = false) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.saveWorkflow(fixture.freshWorkflow); store.setWorkflowActive(fixture.freshWorkflow.id!, true);
  store.setSetting('scheduler.lastObservedAt', fixture.lastObservedAt);
  const key = store.getWorkflowGeneration(fixture.freshWorkflow.id!)!.key;
  store.setSetting('scheduler.pendingOccurrences', fixture.pending.map(row => ({ ...row, ...(proven ? { workflowGeneration: key } : {}) })));
  const calls: unknown[] = [];
  const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
    connectors: { gmail: { name: 'synthetic', execute: async (_action, params) => {
      calls.push(params.query); return { ok: true, data: [] };
    } } } });
  const scheduler = new Scheduler(store, runtime);
  const tick = () => (scheduler as unknown as { tick(): Promise<void> }).tick();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T18:00:00.000Z'));
  return { db, store, runtime, scheduler, calls, tick };
}

describe('legacy pending occurrence upgrade', () => {
  it('does not assign the fresh generation to b595 pending and still runs the next normal schedule exactly once', async () => {
    expect(fixture.generatedWith).toBe('b5950377e81175017d2dcce75593e9359b87787b');
    expect(fixture.generationChangedDuringBaselineRecreation).toBe(true);
    const { db, store, runtime, scheduler, calls, tick } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await tick(); expect(calls).toEqual([]);
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
      expect(store.getSetting('scheduler.lastDiscardedPending', null)).toMatchObject({ code: 'scheduler_pending_generation_missing', count: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
      await tick(); await tick();
      expect(calls).toEqual(['fresh']);
      expect(store.getSetting('scheduler.lastFired:' + encodeURIComponent(fixture.freshWorkflow.id!), null)).toBe('2026-10-03T00:00');
    } finally { await scheduler.stop(); await runtime.waitForIdle(); db.close?.(); }
  });

  it('continues an old pending occurrence with proven ownership of the current generation', async () => {
    const { db, store, runtime, scheduler, calls, tick } = await setup(true);
    try {
      await tick(); await tick();
      expect(calls).toEqual(['fresh']);
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
      expect(store.getSetting('scheduler.lastDiscardedPending', null)).toBeNull();
    } finally { await scheduler.stop(); await runtime.waitForIdle(); db.close?.(); }
  });

  it('calculates a newly due occurrence once even when an unproven legacy entry had the same key', async () => {
    const { db, store, runtime, scheduler, calls, tick } = await setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    try {
      await tick(); await tick();
      expect(calls).toEqual(['fresh']);
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
      expect(store.getSetting('scheduler.lastDiscardedPending', null)).toMatchObject({ code: 'scheduler_pending_generation_missing', count: 1 });
    } finally { await scheduler.stop(); await runtime.waitForIdle(); db.close?.(); }
  });
});

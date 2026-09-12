import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../engine.js';
import { Scheduler } from '../scheduler.js';

describe('scheduler catch-up work bounds', () => {
  it('coalesces a day of missed work for many identical schedules without repeating calendar setup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:25:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (let index = 0; index < 40; index++) {
      const id = `hourly-${index}`;
      store.saveWorkflow({ inputs: [], id, name: id, goal: '놓친 최신 실행 한 번', version: 1,
        trigger: { type: 'schedule', schedule: '0 * * * *', timezone: 'Asia/Seoul' }, steps: [],
        permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} });
      store.setWorkflowActive(id, true);
    }
    store.setSetting('scheduler.lastObservedAt', '2026-09-11T00:25:00Z');
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {} });
    const scheduler = new Scheduler(store, runtime);
    const calendarSetup = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.listExecutions(100)).toHaveLength(40);
      expect(Object.values(store.getSetting('scheduler.lastFired', {}))).toEqual(Array(40).fill('2026-09-12T00:00'));
      // Calendar setup must depend on distinct schedules, not missed minutes x workflow count.
      expect(calendarSetup.mock.calls.length).toBeLessThanOrEqual(50);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store.listExecutions(100)).toHaveLength(40);
    } finally {
      calendarSetup.mockRestore(); scheduler.stop(); await runtime.waitForIdle(); db.close?.(); vi.useRealTimers();
    }
  }, 15_000);
});

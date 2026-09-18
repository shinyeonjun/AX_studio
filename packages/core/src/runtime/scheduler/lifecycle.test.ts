import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { Scheduler } from '../scheduler.js';

describe('Scheduler lifecycle', () => {
  it('waits for an in-flight tick and skips acknowledgement writes after stop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'scheduled-stop',
      name: '종료 중 예약 실행',
      goal: '종료 중 예약 상태 보존',
      version: 1,
      trigger: { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive('scheduled-stop', true);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = {
      executeWorkflow: vi.fn(async () => {
        return await hold.then(() => ({ status: 'success' as const }));
      }),
    };
    const scheduler = new Scheduler(store, runtime as never);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);

      const stopping = scheduler.stop();
      release();
      await stopping;
      await vi.advanceTimersByTimeAsync(0);

      expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({});
      expect(store.getWorkflow('scheduled-stop')).not.toBeNull();
    } finally {
      release();
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });
});

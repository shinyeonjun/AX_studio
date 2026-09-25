import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { Scheduler } from '../scheduler.js';

describe('Scheduler lifecycle', () => {
  it('loads active workflow definitions in one query on an idle tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (let index = 0; index < 50; index += 1) {
      const id = `scheduled-idle-${index}`;
      store.saveWorkflow({
        id,
        name: id,
        goal: 'idle scheduler query measurement',
        version: 1,
        trigger: { type: 'schedule', schedule: '15 1 * * *', timezone: 'UTC' },
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      });
      store.setWorkflowActive(id, true);
    }
    const originalPrepare = db.prepare.bind(db);
    const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => originalPrepare(sql));
    const scheduler = new Scheduler(store, { executeWorkflow: vi.fn() } as never);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(prepare.mock.calls.filter(([sql]) => sql.includes('workflow_versions'))).toHaveLength(1);
    } finally {
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });

  it('does not reread the pending-occurrence setting for every completed schedule', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflowCount = 50;
    for (let index = 0; index < workflowCount; index += 1) {
      const id = `scheduled-due-${index}`;
      store.saveWorkflow({
        id,
        name: id,
        goal: 'measure due scheduler settings reads',
        version: 1,
        trigger: { type: 'schedule', schedule: '* * * * *', timezone: 'UTC' },
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      });
      store.setWorkflowActive(id, true);
    }
    const originalPrepare = db.prepare.bind(db);
    const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => originalPrepare(sql));
    const originalSetSetting = store.setSetting.bind(store);
    let pendingWrites = 0;
    let checkpointWrites = 0;
    let checkpointJsonBytes = 0;
    vi.spyOn(store, 'setSetting').mockImplementation((key, value) => {
      if (key === 'scheduler.pendingOccurrences') pendingWrites += 1;
      if (key.startsWith('scheduler.lastFired:')) {
        checkpointWrites += 1;
        checkpointJsonBytes += JSON.stringify(value).length;
      }
      return originalSetSetting(key, value);
    });
    const executeWorkflow = vi.fn(async () => ({ status: 'success' as const }));
    const scheduler = new Scheduler(store, { executeWorkflow } as never);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      const settingsReads = prepare.mock.calls.filter(([sql]) =>
        sql.includes('SELECT value_json FROM settings'),
      ).length;
      expect(executeWorkflow).toHaveBeenCalledTimes(workflowCount);
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
      expect(checkpointWrites).toBe(workflowCount);
      expect(checkpointJsonBytes).toBeLessThan(workflowCount * 32);
      expect(store.getSetting('scheduler.lastFired', null)).toBeNull();
      expect(settingsReads).toBeLessThan(workflowCount * 4);
      expect(pendingWrites).toBeLessThanOrEqual(2);
    } finally {
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });

  it('batches pending cleanup when a tick has many failed schedules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflowCount = 25;
    for (let index = 0; index < workflowCount; index += 1) {
      const id = `scheduled-failed-${index}`;
      store.saveWorkflow({
        id,
        name: id,
        goal: 'measure failed scheduler cleanup writes',
        version: 1,
        trigger: { type: 'schedule', schedule: '* * * * *', timezone: 'UTC' },
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      });
      store.setWorkflowActive(id, true);
    }
    const originalSetSetting = store.setSetting.bind(store);
    let pendingWrites = 0;
    vi.spyOn(store, 'setSetting').mockImplementation((key, value) => {
      if (key === 'scheduler.pendingOccurrences') pendingWrites += 1;
      return originalSetSetting(key, value);
    });
    const executeWorkflow = vi.fn(async () => ({ status: 'failed' as const }));
    const scheduler = new Scheduler(store, { executeWorkflow } as never);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(executeWorkflow).toHaveBeenCalledTimes(workflowCount);
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
      expect(pendingWrites).toBeLessThanOrEqual(2);
    } finally {
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });

  it('migrates legacy fired checkpoints before deciding whether to run an occurrence', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-12T00:00:00Z');
    vi.setSystemTime(now);
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'legacy:checkpoint';
    const occurrenceKey = '2026-09-12T00:00';
    store.saveWorkflow({
      id,
      name: id,
      goal: 'migrate the legacy scheduler checkpoint without replay',
      version: 1,
      trigger: { type: 'schedule', schedule: '* * * * *', timezone: 'UTC' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive(id, true);
    store.setSetting('scheduler.lastFired', { [id]: occurrenceKey });
    const executeWorkflow = vi.fn(async () => ({ status: 'success' as const }));
    const scheduler = new Scheduler(store, { executeWorkflow } as never);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(executeWorkflow).not.toHaveBeenCalled();
      expect(store.getSetting(`scheduler.lastFired:${encodeURIComponent(id)}`, null)).toBe(occurrenceKey);
      expect(store.getSetting('scheduler.lastFired', null)).toBeNull();
    } finally {
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });

  it('retries a partially written legacy checkpoint migration safely', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const checkpoint = '2026-09-12T00:00';
    store.setSetting('scheduler.lastFired', { first: checkpoint, second: checkpoint });
    const originalSetSetting = store.setSetting.bind(store);
    const migrationError = new Error('simulated storage failure during migration');
    let injectedFailure = false;
    vi.spyOn(store, 'setSetting').mockImplementation((key, value) => {
      if (key === 'scheduler.lastFired:second' && !injectedFailure) {
        injectedFailure = true;
        throw migrationError;
      }
      return originalSetSetting(key, value);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = new Scheduler(store, { executeWorkflow: vi.fn() } as never);

    try {
      await (scheduler as unknown as { tick(): Promise<void> }).tick();

      expect(store.getSetting('scheduler.lastFired:first', null)).toBe(checkpoint);
      expect(store.getSetting('scheduler.lastFired:second', null)).toBeNull();
      expect(store.getSetting('scheduler.lastFired', null)).toEqual({ first: checkpoint, second: checkpoint });
      expect(consoleError).toHaveBeenCalledWith('[scheduler] tick failed:', migrationError);

      await (scheduler as unknown as { tick(): Promise<void> }).tick();

      expect(store.getSetting('scheduler.lastFired:first', null)).toBe(checkpoint);
      expect(store.getSetting('scheduler.lastFired:second', null)).toBe(checkpoint);
      expect(store.getSetting('scheduler.lastFired', null)).toBeNull();
    } finally {
      db.close?.();
      vi.useRealTimers();
    }
  });

  it('does not rerun an occurrence already acknowledged before a restart', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-12T00:00:00Z');
    vi.setSystemTime(now);
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'scheduled-restart-checkpoint';
    const trigger = { type: 'schedule' as const, schedule: '* * * * *', timezone: 'UTC' };
    store.saveWorkflow({
      id,
      name: id,
      goal: 'recover a crash between acknowledgement and pending cleanup',
      version: 1,
      trigger,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive(id, true);
    const occurrenceKey = '2026-09-12T00:00';
    store.setSetting('scheduler.pendingOccurrences', [{
      workflowId: id,
      occurrenceKey,
      triggerType: 'schedule',
      workflowVersion: 1,
      triggerSnapshot: JSON.stringify(trigger),
    }]);
    store.setSetting('scheduler.lastFired', { [id]: occurrenceKey });
    store.setSetting('scheduler.lastObservedAt', now.toISOString());
    const executeWorkflow = vi.fn(async () => ({ status: 'success' as const }));
    const scheduler = new Scheduler(store, { executeWorkflow } as never);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(executeWorkflow).not.toHaveBeenCalled();
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
    } finally {
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });

  it('executes a duplicated persisted occurrence only once per tick', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-12T00:00:00Z');
    vi.setSystemTime(now);
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'scheduled-duplicate-pending';
    const trigger = { type: 'schedule' as const, schedule: '* * * * *', timezone: 'UTC' };
    const occurrence = {
      workflowId: id,
      occurrenceKey: '2026-09-12T00:00',
      triggerType: 'schedule' as const,
      workflowVersion: 1,
      triggerSnapshot: JSON.stringify(trigger),
    };
    store.saveWorkflow({
      id,
      name: id,
      goal: 'avoid duplicate scheduled work from duplicated persisted entries',
      version: 1,
      trigger,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive(id, true);
    store.setSetting('scheduler.pendingOccurrences', [occurrence, occurrence]);
    store.setSetting('scheduler.lastObservedAt', now.toISOString());
    const executeWorkflow = vi.fn(async () => ({ status: 'success' as const }));
    const scheduler = new Scheduler(store, { executeWorkflow } as never);

    try {
      await (scheduler as unknown as { tick(): Promise<void> }).tick();

      expect(executeWorkflow).toHaveBeenCalledTimes(1);
      expect(store.getSetting('scheduler.pendingOccurrences', [])).toEqual([]);
    } finally {
      db.close?.();
      vi.useRealTimers();
    }
  });

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

      expect(store.getSetting('scheduler.lastFired:scheduled-stop', null)).toBeNull();
      expect(store.getWorkflow('scheduled-stop')).not.toBeNull();
      expect(store.getSetting<{ workflowId: string }[]>('scheduler.pendingOccurrences', [])).toHaveLength(1);
    } finally {
      release();
      await scheduler.stop();
      db.close?.();
      vi.useRealTimers();
    }
  });
});

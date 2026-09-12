import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { Scheduler } from '../../scheduler.js';

describe('Scheduler scheduled jobs', () => {
  it.each(['once', 'schedule'] as const)('runs a replacement once job after the old %s execution completes', async (previousType) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({ id: 'replaced', name: 'replaced', goal: 'run the updated reservation', version: 1,
      trigger: previousType === 'once' ? { type: 'once', runAt: '2026-09-12T00:00:00Z' }
        : { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC' },
      steps: [], permissions: {}, approval: [], allowExternalAuto: false,
      assumptions: [], sideEffects: {}, dataPolicy: {} });
    store.setWorkflowActive('replaced', true);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const versions: number[] = [];
    const runtime = { executeWorkflow: vi.fn(async (ir: { version: number }) => {
      versions.push(ir.version);
      if (ir.version === 1) await waiting;
      return { status: 'success' };
    }), removeWorkflow: vi.fn() };
    const scheduler = new Scheduler(store, runtime as never);
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(versions).toEqual([1]);
      store.saveWorkflow({ ...store.getWorkflow('replaced')!, version: 2,
        trigger: { type: 'once', runAt: '2026-09-12T00:00:30Z' } });
      release();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(versions).toEqual([1, 2]);
      expect(store.getWorkflow('replaced')).toBeNull();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(versions).toEqual([1, 2]);
    } finally {
      release(); scheduler.stop();
      await vi.advanceTimersByTimeAsync(0);
      db.close?.();
    }
  });

  it.each(['restart', 'edit-queued'] as const)('does not replay or delete completed/replaced work: %s', async (scenario) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (const id of ['first', 'peer']) {
      store.saveWorkflow({ id, name: id, goal: 'preserve scheduled work', version: 1,
        trigger: id === 'peer' ? { type: 'once', runAt: '2026-09-12T00:00:00Z' }
          : { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC' },
        steps: [], permissions: {}, approval: [], allowExternalAuto: false,
        assumptions: [], sideEffects: {}, dataPolicy: {} });
      store.setWorkflowActive(id, true);
    }
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const runtime = { executeWorkflow: vi.fn(async (ir: { id: string }) => {
      calls.push(ir.id);
      if (ir.id === 'first') await wait;
      return { status: 'success' };
    }), removeWorkflow: vi.fn() };
    const scheduler = new Scheduler(store, runtime as never);
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      if (scenario === 'restart') scheduler.stop();
      else store.saveWorkflow({ ...store.getWorkflow('peer')!, version: 2,
        trigger: { type: 'schedule', schedule: '0 0 1 1 *', timezone: 'UTC' } });
      release();
      await vi.advanceTimersByTimeAsync(0);
      if (scenario === 'restart') {
        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toEqual(['first', 'peer']);
      } else {
        expect(calls).toEqual(['first']);
        expect(store.getWorkflow('peer')?.trigger?.type).toBe('schedule');
      }
    } finally {
      release(); scheduler.stop();
      await vi.advanceTimersByTimeAsync(0);
      db.close?.();
    }
  });

  it.each(['workflow', 'global'] as const)('honors a %s pause while a peer occurrence waits', async (pause) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (const id of ['first', 'peer']) {
      store.saveWorkflow({ id, name: id, goal: 'pause queued work', version: 1,
        trigger: { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC' },
        steps: [], permissions: {}, approval: [], allowExternalAuto: false,
        assumptions: [], sideEffects: {}, dataPolicy: {} });
      store.setWorkflowActive(id, true);
    }
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const runtime = { executeWorkflow: vi.fn(async (ir: { id: string }) => {
      calls.push(ir.id);
      if (ir.id === 'first') await wait;
      return { status: 'success' };
    }) };
    const scheduler = new Scheduler(store, runtime as never);
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(['first']);
      if (pause === 'workflow') store.setWorkflowActive('peer', false);
      else store.setSetting('globalActive', false);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(['first']);
    } finally {
      release();
      scheduler.stop();
      await vi.advanceTimersByTimeAsync(0);
      db.close?.();
    }
  });

  it('keeps a peer occurrence when the first workflow crosses a minute boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (const id of ['first', 'peer']) {
      store.saveWorkflow({
        id,
        name: id,
        goal: '동일 시각 예약 실행',
        version: 1,
        trigger: { type: 'schedule', schedule: '30 9 * * *', timezone: 'Asia/Seoul' },
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      });
      store.setWorkflowActive(id, true);
    }

    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = {
      executeWorkflow: vi.fn(async (ir: { id?: string }) => {
        calls.push(ir.id ?? 'unknown');
        if (ir.id === 'first') {
          vi.setSystemTime(new Date('2026-01-01T00:31:05.000Z'));
          await firstFinished;
        }
        return { status: 'success' };
      }),
    };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    const runningTick = tick();
    await Promise.resolve();
    expect(calls).toEqual(['first']);

    releaseFirst();
    await runningTick;

    expect(calls).toEqual(['first', 'peer']);
    db.close?.();
  });

  it('deduplicates each minute while preserving hourly, restart and next-day occurrences', async () => {
    vi.useFakeTimers();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({ id: 'hourly', name: '매시간 확인', goal: '매시간 연결 자료 확인', version: 1,
      trigger: { type: 'schedule', schedule: '0 * * * *', timezone: 'Asia/Seoul' },
      steps: [], permissions: {}, approval: [], allowExternalAuto: false,
      assumptions: [], sideEffects: {}, dataPolicy: {} });
    store.setWorkflowActive('hourly', true);
    const runtime = { executeWorkflow: vi.fn(async () => ({ status: 'success' })) };
    let scheduler = new Scheduler(store, runtime as never);
    for (const timestamp of ['2026-09-06T00:00:00Z', '2026-09-06T00:00:30Z', '2026-09-06T01:00:00Z']) {
      vi.setSystemTime(new Date(timestamp));
      await (scheduler as unknown as { tick(): Promise<void> }).tick();
    }
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    scheduler = new Scheduler(store, runtime as never);
    await (scheduler as unknown as { tick(): Promise<void> }).tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-09-07T01:00:00Z'));
    await (scheduler as unknown as { tick(): Promise<void> }).tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(3);
    db.close?.();
  });

  it('coalesces occurrences missed during sleep to the latest due minute', async () => {
    vi.useFakeTimers();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({ id: 'sleep-catch-up', name: '절전 복구', goal: '놓친 예약 복구', version: 1,
      trigger: { type: 'schedule', schedule: '0 * * * *', timezone: 'Asia/Seoul' },
      steps: [], permissions: {}, approval: [], allowExternalAuto: false,
      assumptions: [], sideEffects: {}, dataPolicy: {} });
    store.setWorkflowActive('sleep-catch-up', true);
    const runtime = { executeWorkflow: vi.fn(async () => ({ status: 'success' })) };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    vi.setSystemTime(new Date('2026-09-06T00:00:00Z'));
    await tick();
    vi.setSystemTime(new Date('2026-09-06T03:00:00Z'));
    await tick();

    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({
      'sleep-catch-up': '2026-09-06T03:00',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a failed scheduled job without running it again after success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'scheduled-retry',
      name: '예약 재시도',
      goal: '실패한 예약 업무는 같은 예약 분에 재시도',
      version: 1,
      trigger: { type: 'schedule', schedule: '30 9 * * *', timezone: 'Asia/Seoul' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive('scheduled-retry', true);

    const statuses = ['failed', 'success'] as const;
    const runtime = {
      executeWorkflow: vi.fn(async () => ({ status: statuses.shift() ?? 'success' })),
    };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({});

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({
      'scheduled-retry': expect.any(String),
    });

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
  });

  it('ignores invalid persisted last-fired entries without stopping scheduled jobs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'scheduled-after-corruption',
      name: '손상 복구 예약',
      goal: '손상된 예약 상태와 무관하게 실행',
      version: 1,
      trigger: { type: 'schedule', schedule: '30 9 * * *', timezone: 'Asia/Seoul' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive('scheduled-after-corruption', true);
    store.setSetting('scheduler.lastFired', {
      'scheduled-after-corruption': false,
      valid: '2026-01-01T00:29',
    });

    const runtime = { executeWorkflow: vi.fn(async () => ({ status: 'success' })) };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await expect(tick()).resolves.toBeUndefined();

    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);
    expect(store.getSetting<Record<string, unknown>>('scheduler.lastFired', {})).toEqual({
      'scheduled-after-corruption': expect.any(String),
      valid: '2026-01-01T00:29',
    });

    store.setSetting('scheduler.lastFired', null);
    vi.setSystemTime(new Date('2026-01-02T00:30:00.000Z'));
    await expect(tick()).resolves.toBeUndefined();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { Scheduler } from '../../scheduler.js';

describe('Scheduler scheduled jobs', () => {
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

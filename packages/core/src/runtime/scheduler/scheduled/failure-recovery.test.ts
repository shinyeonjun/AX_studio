import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { Scheduler } from '../../scheduler.js';

describe('Scheduler scheduled jobs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('isolates scheduled workflow exceptions and continues the same tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (const id of ['throws', 'succeeds']) {
      store.saveWorkflow({
        id,
        name: id,
        goal: '예약 실행 오류 격리',
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

    const failure = new Error('temporary runtime failure');
    const runtime = {
      executeWorkflow: vi.fn(async (ir: { id?: string }) => {
        if (ir.id === 'throws') throw failure;
        return { status: 'success' };
      }),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await expect(tick()).resolves.toBeUndefined();

    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      '[scheduler] execution failed for workflow throws:',
      failure,
    );
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({
      succeeds: expect.any(String),
    });
  });

  it('recovers on the next tick after an unexpected scheduler failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'scheduled-recovery',
      name: '예약 오류 복구',
      goal: '일시적인 스케줄러 오류 후 다음 tick에서 실행',
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
    store.setWorkflowActive('scheduled-recovery', true);

    const failure = new Error('temporary store failure');
    vi.spyOn(store, 'listWorkflows').mockImplementationOnce(() => {
      throw failure;
    });
    const runtime = {
      executeWorkflow: vi.fn(async () => ({ status: 'success' })),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await expect(tick()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('[scheduler] tick failed:', failure);
    expect(runtime.executeWorkflow).not.toHaveBeenCalled();

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { Scheduler } from '../scheduler.js';

describe('Scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not run a one-time job with an invalid run time', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'once-invalid',
      name: '잘못된 일회성 작업',
      goal: '유효한 실행 시각이 필요함',
      version: 1,
      trigger: { type: 'once', runAt: 'not-a-date' },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive('once-invalid', true);

    const runtime = {
      executeWorkflow: vi.fn(),
      removeWorkflow: vi.fn(),
    };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await tick();

    expect(runtime.executeWorkflow).not.toHaveBeenCalled();
    expect(store.listWorkflows()[0]?.active).toBe(true);
  });

  it('lets a reactivated once job fire again after pending approval', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'once-approval',
      name: '승인 대기 일회성',
      goal: '승인 대기 후 재활성화하면 다시 실행',
      version: 1,
      trigger: { type: 'once', runAt: new Date(Date.now() - 1_000).toISOString() },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    store.setWorkflowActive('once-approval', true);

    const runtime = {
      executeWorkflow: vi.fn(async () => ({ status: 'pending_approval' })),
      removeWorkflow: vi.fn(),
    };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);
    expect(store.listWorkflows()[0]?.active).toBe(false);
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({});

    store.setWorkflowActive('once-approval', true);
    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
  });
});

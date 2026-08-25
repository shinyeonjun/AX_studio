import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not consume a one-time job when its execution fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'once-workflow',
      name: '일회성 재시도',
      goal: '실패한 일회성 업무는 재시도',
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
    store.setWorkflowActive('once-workflow', true);

    const statuses = ['failed', 'success'] as const;
    const runtime = {
      executeWorkflow: vi.fn(async () => ({ status: statuses.shift() ?? 'failed' })),
      removeWorkflow: vi.fn(),
    };
    const scheduler = new Scheduler(
      store,
      runtime as never,
    );
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({});
    expect(store.listWorkflows()[0]?.active).toBe(true);

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    // deleteWorkflow prunes the workflow-keyed scheduler/trigger settings.
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})).toEqual({});
    expect(store.getWorkflow('once-workflow')).toBeNull();
  });

  it('does not start the same one-time job from overlapping ticks', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'once-slow',
      name: '느린 일회성 작업',
      goal: '실행 중인 작업을 중복 시작하지 않음',
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
    store.setWorkflowActive('once-slow', true);

    let finishExecution!: (result: { status: 'failed' }) => void;
    const execution = new Promise<{ status: 'failed' }>((resolve) => {
      finishExecution = resolve;
    });
    const runtime = {
      executeWorkflow: vi.fn(() => execution),
      removeWorkflow: vi.fn(),
    };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    const firstTick = tick();
    await vi.waitFor(() => expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1));
    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);

    finishExecution({ status: 'failed' });
    await firstTick;
    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
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

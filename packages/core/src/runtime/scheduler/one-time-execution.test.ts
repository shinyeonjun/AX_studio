import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { Scheduler } from '../scheduler.js';

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
    expect(store.getSetting('scheduler.lastFired:once-workflow', null)).toBeNull();
    expect(store.listWorkflows()[0]?.active).toBe(true);

    await tick();
    expect(runtime.executeWorkflow).toHaveBeenCalledTimes(2);
    // deleteWorkflow prunes the workflow-keyed scheduler/trigger settings.
    expect(store.getSetting('scheduler.lastFired:once-workflow', null)).toBeNull();
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

  it('blocks workflow writes while removing a completed one-time workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = {
      id: 'once-delete-race',
      name: '일회성 삭제 경쟁',
      goal: '완료된 일회성 작업을 정리한다',
      version: 1,
      trigger: { type: 'once' as const, runAt: new Date(Date.now() - 1_000).toISOString() },
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };
    store.saveWorkflow(workflow);
    store.setWorkflowActive(workflow.id, true);

    let finishRemoval!: () => void;
    let markRemovalStarted!: () => void;
    const removalStarted = new Promise<void>((resolve) => { markRemovalStarted = resolve; });
    const removalGate = new Promise<void>((resolve) => { finishRemoval = resolve; });
    const runtime = {
      executeWorkflow: vi.fn(async () => ({ status: 'success' })),
      removeWorkflow: vi.fn(async () => {
        markRemovalStarted();
        await removalGate;
      }),
    };
    const scheduler = new Scheduler(store, runtime as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);

    try {
      const runningTick = tick();
      await removalStarted;
      expect(() => store.saveWorkflow({ ...workflow, name: '삭제 중 수정', version: 1 }))
        .toThrow(expect.objectContaining({ code: 'workflow_deletion_in_progress' }));
      expect(() => store.setWorkflowActive(workflow.id, true))
        .toThrow(expect.objectContaining({ code: 'workflow_deletion_in_progress' }));
      finishRemoval();
      await runningTick;
      expect(store.getWorkflow(workflow.id)).toBeNull();
    } finally {
      finishRemoval();
      db.close?.();
    }
  });
});

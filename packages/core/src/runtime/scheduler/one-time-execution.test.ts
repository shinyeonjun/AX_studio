import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { Scheduler } from '../scheduler.js';
import { WorkflowRuntime } from '../engine.js';

describe('Scheduler', () => {
  it('retains the completed execution after retiring a successful one-time workflow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow({ inputs: [], id: 'once-receipt', name: '완료 이력 보존', goal: '활동에 결과 남기기', version: 1,
      trigger: { type: 'once', runAt: '2026-09-11T23:59:59Z' }, steps: [], permissions: {}, approval: [],
      allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} });
    store.setWorkflowActive(workflowId, true);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {} });
    const scheduler = new Scheduler(store, runtime);
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getWorkflow(workflowId)).toBeNull();
      expect(store.listExecutions()).toEqual([expect.objectContaining({ workflowId, status: 'success', triggerType: 'once' })]);
    } finally { scheduler.stop(); await runtime.waitForIdle(); db.close?.(); }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not consume a one-time job when its execution fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({ inputs: [],
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

    const statuses = ['failed', 'success'] as Array<'failed' | 'success'>;
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
    store.saveWorkflow({ inputs: [],
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
});

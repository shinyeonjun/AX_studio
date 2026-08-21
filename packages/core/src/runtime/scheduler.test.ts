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
    expect(store.getSetting<Record<string, string>>('scheduler.lastFired', {})['once-workflow']).toBeTruthy();
    expect(store.getWorkflow('once-workflow')).toBeNull();
  });
});

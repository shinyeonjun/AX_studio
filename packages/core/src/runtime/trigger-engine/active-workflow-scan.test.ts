import { describe, expect, it, vi } from 'vitest';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { TriggerEventCoordinator } from './events.js';
import { runTriggerPoll } from './poll/run.js';

async function createWorkflowStore(triggerFor: (index: number) => NonNullable<WorkflowIR['trigger']>) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  for (let index = 0; index < 50; index += 1) {
    const id = `active-scan-${index}`;
    store.saveWorkflow({
      id,
      name: id,
      goal: 'active workflow scan query measurement',
      version: 1,
      trigger: triggerFor(index),
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
  return { db, store };
}

describe('active workflow scan query count', () => {
  it('loads active definitions once while dispatching a push event', async () => {
    const { db, store } = await createWorkflowStore((index) => index === 0
      ? { type: 'webhook.inbound', path: 'target' }
      : { type: 'schedule', schedule: '15 1 * * *', timezone: 'UTC' });
    const originalPrepare = db.prepare.bind(db);
    const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => originalPrepare(sql));
    const runtime = { executeWorkflow: vi.fn(async () => ({ status: 'success', executionId: 'push-run' })) };
    const coordinator = new TriggerEventCoordinator(store, runtime as never, () => true);
    const driver = PUSH_TRIGGER_DRIVERS.find(({ triggerType }) => triggerType === 'webhook.inbound')!;

    try {
      await coordinator.handlePushEvent(driver, {
        type: 'webhook.inbound',
        payload: { path: 'target', requestId: 'push-request' },
      });

      expect(runtime.executeWorkflow).toHaveBeenCalledTimes(1);
      expect(prepare.mock.calls.filter(([sql]) => sql.includes('workflow_versions'))).toHaveLength(1);
    } finally {
      db.close?.();
    }
  });

  it('loads active definitions once while polling', async () => {
    const { db, store } = await createWorkflowStore(() => ({
      type: 'schedule', schedule: '15 1 * * *', timezone: 'UTC',
    }));
    const originalPrepare = db.prepare.bind(db);
    const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => originalPrepare(sql));

    try {
      await runTriggerPoll({
        store,
        runtime: { executeWorkflow: vi.fn() } as never,
        getLifecycleGeneration: () => 1,
        isCurrentGeneration: () => true,
        pushTransportActive: () => false,
        rememberEvent: () => true,
      }, 1);

      expect(prepare.mock.calls.filter(([sql]) => sql.includes('workflow_versions'))).toHaveLength(1);
    } finally {
      db.close?.();
    }
  });
});

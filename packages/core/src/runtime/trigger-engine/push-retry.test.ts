import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { TriggerEvent } from '../../triggers/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { WorkflowRuntime } from '../engine.js';

const driverState = vi.hoisted(() => ({ emitters: [] as Array<(event: TriggerEvent) => Promise<unknown> | unknown> }));

vi.mock('../../connectors/packages/catalog.js', () => ({
  PUSH_TRIGGER_DRIVERS: [{
    connector: 'webhook',
    triggerType: 'webhook.inbound',
    async refresh(_store: unknown, emit: (event: TriggerEvent) => unknown) {
      driverState.emitters.push(emit);
      return { stop: async () => undefined, isRunning: () => true };
    },
    matchesTrigger: () => true,
    dedupeKey: (workflowId: string, event: TriggerEvent) => `${workflowId}:${String(event.payload.requestId)}`,
  }],
}));

const { TriggerEngine } = await import('../trigger-engine.js');

const workflow: WorkflowIR = {
  name: 'Webhook workflow', goal: 'Run from a webhook', version: 1,
  trigger: { type: 'webhook.inbound', path: 'events' },
  inputs: [], steps: [], permissions: {}, approval: [], allowExternalAuto: true,
  assumptions: [], sideEffects: {}, dataPolicy: {},
};

const refused = () => Object.assign(new Error('queue full'), { code: 'workflow_run_queue_full' });

async function setup(executeWorkflow: ReturnType<typeof vi.fn>) {
  const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
  const { workflowId } = store.saveWorkflow(workflow);
  store.setWorkflowActive(workflowId, true);
  const engine = new TriggerEngine(store, { executeWorkflow, connectors: {} } as unknown as WorkflowRuntime);
  engine.start();
  await vi.waitFor(() => expect(driverState.emitters).toHaveLength(1));
  return { store, engine };
}

describe('a webhook event the runtime refused to start', () => {
  beforeEach(() => { driverState.emitters.length = 0; });

  it('is retried on a later tick and runs exactly once', async () => {
    const executeWorkflow = vi.fn()
      .mockRejectedValueOnce(refused())
      .mockResolvedValue({ status: 'success', executionId: 'exec-1' });
    const { store, engine } = await setup(executeWorkflow);
    try {
      await driverState.emitters[0]!({ type: 'webhook.inbound', payload: { requestId: 'r1', path: 'events' } });
      await vi.waitFor(() => expect(executeWorkflow).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(store.getSetting<unknown[]>('trigger.pushJournal', [])).toHaveLength(1));

      await engine.tick();
      await vi.waitFor(() => expect(executeWorkflow).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(store.getSetting<unknown[]>('trigger.pushJournal', [])).toHaveLength(0));
      await engine.tick();
      expect(executeWorkflow).toHaveBeenCalledTimes(2);
    } finally {
      await engine.stop();
    }
  });

  it('is dropped after a bounded number of refused starts', async () => {
    const executeWorkflow = vi.fn().mockRejectedValue(refused());
    const { store, engine } = await setup(executeWorkflow);
    try {
      await driverState.emitters[0]!({ type: 'webhook.inbound', payload: { requestId: 'r2', path: 'events' } });
      await vi.waitFor(() => expect(executeWorkflow).toHaveBeenCalledTimes(1));
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await vi.waitFor(() => expect(executeWorkflow.mock.calls.length).toBeGreaterThanOrEqual(Math.min(attempt + 1, 6)));
        await engine.tick();
      }
      await vi.waitFor(() => expect(store.getSetting<unknown[]>('trigger.pushJournal', [])).toHaveLength(0));
      expect(executeWorkflow).toHaveBeenCalledTimes(6);
    } finally {
      await engine.stop();
    }
  });
});

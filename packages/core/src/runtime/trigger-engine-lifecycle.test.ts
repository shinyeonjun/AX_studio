import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import type { TriggerEvent } from '../triggers/types.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { WorkflowRuntime } from './engine.js';

const driverState = vi.hoisted(() => ({
  emitters: [] as Array<(event: TriggerEvent) => void>,
}));

vi.mock('../modules/packages/catalog.js', () => ({
  PUSH_TRIGGER_DRIVERS: [{
    triggerType: 'webhook.inbound',
    async refresh(_store: unknown, emit: (event: TriggerEvent) => void) {
      driverState.emitters.push(emit);
      return {
        stop: async () => undefined,
        isRunning: () => true,
      };
    },
    matchesTrigger: () => true,
    dedupeKey: (_workflowId: string, event: TriggerEvent) => String(event.payload.requestId),
  }],
}));

import { TriggerEngine } from './trigger-engine.js';

const webhookWorkflow: WorkflowIR = {
  name: 'Webhook workflow',
  goal: 'Run from a webhook',
  version: 1,
  trigger: { type: 'webhook.inbound', path: 'events' },
  inputs: [],
  steps: [],
  permissions: {},
  approval: [],
  allowExternalAuto: true,
  assumptions: [],
  sideEffects: {},
  dataPolicy: {},
};

const event = (requestId: string): TriggerEvent => ({
  type: 'webhook.inbound',
  payload: { requestId, path: 'events' },
});

describe('TriggerEngine push transport lifecycle', () => {
  beforeEach(() => {
    driverState.emitters.length = 0;
  });

  it('ignores callbacks from replaced and stopped push transports', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow(webhookWorkflow);
    store.setWorkflowActive(workflowId, true);
    const executeWorkflow = vi.fn().mockResolvedValue({ status: 'success', executionId: 'execution-1' });
    const runtime = { executeWorkflow, connectors: {} } as unknown as WorkflowRuntime;
    const engine = new TriggerEngine(store, runtime);

    engine.start();
    await vi.waitFor(() => expect(driverState.emitters).toHaveLength(1));
    await engine.refreshPushTransports();
    expect(driverState.emitters).toHaveLength(2);

    driverState.emitters[0]!(event('stale'));
    driverState.emitters[1]!(event('current'));
    await vi.waitFor(() => expect(executeWorkflow).toHaveBeenCalledTimes(1));

    await engine.stop();
    driverState.emitters[1]!(event('stopped'));
    await Promise.resolve();

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });
});

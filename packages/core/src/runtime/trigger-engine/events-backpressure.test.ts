import { describe, expect, it, vi } from 'vitest';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { TriggerEventCoordinator } from './events.js';

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

const webhookEvent = (requestId: string) => ({
  type: 'webhook.inbound' as const,
  payload: { requestId, path: 'events' },
});

describe('TriggerEventCoordinator backpressure', () => {
  it('rejects overflow for provider retry and drains every accepted event', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow(webhookWorkflow);
    store.setWorkflowActive(workflowId, true);

    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
    const executeWorkflow = vi.fn(async (_workflow: unknown, context: { input: { requestId: string } }) => {
      await activeGate;
      return { status: 'success', executionId: `execution-${context.input.requestId}` };
    });
    const coordinator = new TriggerEventCoordinator(store, { executeWorkflow } as never, () => true);
    const driver = PUSH_TRIGGER_DRIVERS.find(({ triggerType }) => triggerType === 'webhook.inbound')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const results = await Promise.all(Array.from({ length: 150 }, (_, index) =>
        coordinator.handlePushEvent(driver, webhookEvent(String(index))),
      ));
      expect(results.filter(Boolean)).toHaveLength(144);
      expect(results.filter((accepted) => !accepted)).toHaveLength(6);
      expect(executeWorkflow).toHaveBeenCalledTimes(16);
      expect(warn).toHaveBeenCalledTimes(6);

      let drained = false;
      const drain = coordinator.drain().then(() => { drained = true; });
      await Promise.resolve();
      expect(drained).toBe(false);
      releaseActive();
      await drain;
      expect(executeWorkflow).toHaveBeenCalledTimes(144);

      expect(await coordinator.handlePushEvent(driver, webhookEvent('144'))).toBe(true);
      await coordinator.drain();
      expect(executeWorkflow).toHaveBeenCalledTimes(145);
    } finally {
      releaseActive();
      warn.mockRestore();
      db.close?.();
    }
  });
});

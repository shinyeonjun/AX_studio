import { describe, expect, it } from 'vitest';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { WorkflowRuntime } from '../engine.js';
import { TriggerEventCoordinator } from './events.js';

describe('push workflow generation ownership', () => {
  it('permits a fresh generation event while the old generation is delivering its result', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'synthetic-inflight-generation';
    const workflow: WorkflowIR = { id, name: 'Old synthetic push', goal: 'Local push retry ownership', version: 1,
      trigger: { type: 'webhook.inbound', path: 'synthetic' }, inputs: [], steps: [], permissions: {}, approval: [],
      allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
    store.saveWorkflow(workflow); store.setWorkflowActive(id, true);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    let entered!: () => void; let release!: () => void;
    const completed = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = []; let freshExecutionId: string | undefined;
    const facade = { executeWorkflow: async (snapshot: WorkflowIR) => {
      calls.push(snapshot.name);
      const result = await runtime.executeWorkflow(snapshot);
      if (snapshot.name === workflow.name) { entered(); await held; }
      else freshExecutionId = result.executionId;
      return result;
    } };
    const notifications: string[] = [];
    const coordinator = new TriggerEventCoordinator(store, facade as never, () => true, workflowId => notifications.push(workflowId));
    const driver = PUSH_TRIGGER_DRIVERS.find(({ triggerType }) => triggerType === 'webhook.inbound')!;
    const event = { type: 'webhook.inbound' as const, payload: { path: 'synthetic', requestId: 'synthetic-event' } };
    await coordinator.handlePushEvent(driver, event); await completed;
    try {
      expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
      store.saveWorkflow({ ...workflow, name: 'Fresh synthetic push' }); store.setWorkflowActive(id, true);
      await coordinator.handlePushEvent(driver, event);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(calls).toEqual(['Old synthetic push', 'Fresh synthetic push']);
      release(); await coordinator.drain();
      expect(notifications).toEqual([id]);
      expect(db.prepare('SELECT status, execution_id FROM trigger_receipts').get()).toEqual({ status: 'completed', execution_id: freshExecutionId });
      expect(Reflect.get(coordinator, 'inFlightEvents').size).toBe(0);
    } finally { release(); await coordinator.drain(); db.close?.(); }
  });

  it.each(['success', 'error'] as const)('leaves the fresh receipt and queued peer alone after a late %s', async (outcome) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = (id: string): WorkflowIR => ({ id, name: 'Synthetic push', goal: 'Local push ownership', version: 1,
      trigger: { type: 'webhook.inbound', path: 'synthetic' }, inputs: [], steps: [], permissions: {}, approval: [],
      allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} });
    for (const id of ['synthetic-active-push', 'synthetic-peer-push']) {
      store.saveWorkflow(workflow(id)); store.setWorkflowActive(id, true);
    }
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const called: string[] = [];
    let entered!: () => void; let release!: () => void;
    const completed = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const facade = { executeWorkflow: async (snapshot: WorkflowIR) => {
      called.push(snapshot.id!);
      const result = await runtime.executeWorkflow(snapshot); entered(); await held;
      if (outcome === 'error') throw new Error('synthetic late delivery error');
      return result;
    } };
    const notifications: string[] = [];
    const coordinator = new TriggerEventCoordinator(store, facade as never, () => true, id => notifications.push(id));
    const driver = PUSH_TRIGGER_DRIVERS.find(({ triggerType }) => triggerType === 'webhook.inbound')!;
    const event = { type: 'webhook.inbound' as const, payload: { path: 'synthetic', requestId: 'synthetic-event' } };
    await coordinator.handlePushEvent(driver, event); await completed;
    try {
      for (const id of ['synthetic-active-push', 'synthetic-peer-push']) {
        expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
        await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
        store.saveWorkflow(workflow(id)); store.setWorkflowActive(id, true);
        expect(store.claimTriggerReceipt({ dedupeKey: driver.dedupeKey(id, event), workflowId: id, triggerType: driver.triggerType })).toBe(true);
      }
      release(); await coordinator.drain();
      expect(called).toEqual(['synthetic-active-push']);
      expect(notifications).toEqual([]);
      expect(db.prepare('SELECT status FROM trigger_receipts').all()).toEqual([{ status: 'processing' }, { status: 'processing' }]);
      expect(Reflect.get(coordinator, 'inFlightEvents').size).toBe(0);
      expect(Reflect.get(coordinator, 'queuedPushEvents')).toHaveLength(0);
    } finally { release(); await coordinator.drain(); db.close?.(); }
  });
});

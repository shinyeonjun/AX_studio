import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { WorkflowRuntime } from '../engine.js';
import { Scheduler } from '../scheduler.js';

function workflow(id: string, type: 'once' | 'schedule'): WorkflowIR {
  return { id, name: 'Synthetic schedule', goal: 'Local generation ownership', version: 1,
    trigger: type === 'once' ? { type, runAt: '2026-01-01T00:00:00Z' }
      : { type, schedule: '* * * * *', timezone: 'UTC' },
    inputs: [], steps: [], permissions: {}, approval: [], allowExternalAuto: false,
    assumptions: [], sideEffects: {}, dataPolicy: {} };
}

describe('scheduler workflow generation ownership', () => {
  it.each(['once', 'schedule'] as const)('does not acknowledge or delete a recreated ID after an old %s result', async (type) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'synthetic-recreated-schedule';
    const ir = workflow(id, type);
    store.saveWorkflow(ir); store.setWorkflowActive(id, true);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    let entered!: () => void; let release!: () => void;
    const completed = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const facade = { executeWorkflow: async (snapshot: WorkflowIR) => {
      const result = await runtime.executeWorkflow(snapshot); entered(); await held; return result;
    }, removeWorkflow: runtime.removeWorkflow.bind(runtime) };
    const scheduler = new Scheduler(store, facade as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick(); await completed;
    try {
      expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
      store.saveWorkflow({ ...ir }); store.setWorkflowActive(id, true);
      release(); await tick;
      expect(store.getWorkflow(id)?.version).toBe(1);
      expect(store.isWorkflowActive(id)).toBe(true);
      expect(store.getSetting(`scheduler.lastFired:${encodeURIComponent(id)}`, null)).toBeNull();
    } finally { release(); await tick; await scheduler.stop(); db.close?.(); }
  });

  it('does not dispatch an old queued occurrence against a recreated peer ID', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    for (const id of ['synthetic-gate', 'synthetic-peer']) {
      store.saveWorkflow(workflow(id, 'schedule')); store.setWorkflowActive(id, true);
    }
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    let entered!: () => void; let release!: () => void;
    const completed = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const called: string[] = [];
    const facade = { executeWorkflow: async (snapshot: WorkflowIR) => {
      called.push(snapshot.id!);
      const result = await runtime.executeWorkflow(snapshot);
      if (snapshot.id === 'synthetic-gate') { entered(); await held; }
      return result;
    } };
    const scheduler = new Scheduler(store, facade as never);
    const tick = (scheduler as unknown as { tick(): Promise<void> }).tick(); await completed;
    try {
      const id = 'synthetic-peer';
      expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
      expect(store.getSetting<Array<{ workflowId: string }>>('scheduler.pendingOccurrences', []).some(row => row.workflowId === id)).toBe(false);
      store.saveWorkflow(workflow(id, 'schedule')); store.setWorkflowActive(id, true);
      release(); await tick;
      expect(called).toEqual(['synthetic-gate']);
      expect(store.getSetting(`scheduler.lastFired:${encodeURIComponent(id)}`, null)).toBeNull();
    } finally { release(); await tick; await scheduler.stop(); db.close?.(); }
  });
});

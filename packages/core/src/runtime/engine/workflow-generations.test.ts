import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { WorkflowRuntime } from '../engine.js';
import type { ExecutionResult } from '../types.js';

function workflow(id?: string): WorkflowIR {
  return { ...(id ? { id } : {}), name: 'Synthetic generation', goal: 'Local lifecycle only', version: 1,
    inputs: [], steps: [], permissions: {}, approval: [], allowExternalAuto: false,
    assumptions: [], sideEffects: {}, dataPolicy: {} };
}

async function remove(store: WorkflowStore, runtime: WorkflowRuntime, id: string) {
  const current = store.getWorkflow(id)!;
  expect(store.claimWorkflowDeletion(id, current.version)).toBe(true);
  try { await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); }
  finally { store.releaseWorkflowDeletion(id); }
}

describe('saved workflow generation lifetime', () => {
  it('keeps active definitions as one batch read and hides lifecycle metadata from JSON', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    try {
      for (let index = 0; index < 8; index++) {
        const id = `synthetic-batch-${index}`;
        store.saveWorkflow(workflow(id)); store.setWorkflowActive(id, true);
      }
      const prepare = vi.spyOn(db, 'prepare');
      const rows = store.listActiveWorkflowDefinitions();
      expect(rows).toHaveLength(8);
      expect(prepare).toHaveBeenCalledTimes(1);
      for (const row of rows) {
        const generation = store.getWorkflowSnapshotGeneration(row.workflow);
        expect(generation).toBeDefined();
        expect(JSON.stringify(row)).not.toContain(generation!.key);
      }
    } finally { db.close?.(); }
  });
  it('releases state after 1500 real create/delete cycles and still blocks the earliest saved snapshot', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const flags: Record<string, boolean> = {};
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: flags });
    let first!: WorkflowIR;
    try {
      for (let index = 0; index < 1500; index++) {
        const id = `synthetic-generation-${index}`;
        store.saveWorkflow(workflow(id));
        const saved = store.getWorkflow(id)!;
        if (index === 0) first = saved;
        store.setWorkflowActive(id, true);
        runtime.setWorkflowActive(id, true);
        await remove(store, runtime, id);
      }
      expect(Object.keys(flags)).toHaveLength(0);
      expect(Reflect.get(store, 'workflowGenerations')?.size ?? 0).toBe(0);
      await expect(runtime.executeWorkflow(first, { forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      await expect(runtime.executeWorkflow(first, { ephemeral: true, forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      expect(() => runtime.enqueueEphemeralWorkflow(first)).toThrow('workflow_removed');
      expect(store.listWorkflows()).toHaveLength(0);
    } finally { db.close?.(); }
  }, 30_000);

  it('blocks the old generation after the same ID and version are recreated', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    try {
      const id = 'synthetic-recreated';
      store.saveWorkflow(workflow(id));
      const old = store.getWorkflow(id)!;
      await remove(store, runtime, id);
      store.saveWorkflow(workflow(id));
      store.setWorkflowActive(id, true);
      runtime.setWorkflowActive(id, true);
      const fresh = store.getWorkflow(id)!;
      expect(fresh.version).toBe(old.version);
      await expect(runtime.executeWorkflow(old, { forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      expect((await runtime.executeWorkflow(fresh, { forceManual: true })).status).toBe('success');
      await remove(store, runtime, id);
      expect(Reflect.get(store, 'workflowGenerations')?.size ?? 0).toBe(0);
    } finally { db.close?.(); }
  });

  it('keeps historical versions in their live generation and rejects unowned ID copies', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const id = 'synthetic-versioned';
    try {
      store.saveWorkflow(workflow(id));
      const old = store.getWorkflow(id)!;
      store.saveWorkflow({ ...old, name: 'Edited synthetic definition' });
      const latest = store.getWorkflow(id)!;
      const historical = store.getWorkflow(id, 1)!;
      expect(latest.version).toBe(2);
      expect(store.getWorkflowSnapshotGeneration(latest)).toBe(store.getWorkflowSnapshotGeneration(old));
      for (const snapshot of [old, historical, latest]) {
        expect((await runtime.executeWorkflow(snapshot, { forceManual: true })).status).toBe('success');
      }
      const ephemeral = await runtime.executeWorkflow(latest, { ephemeral: true, forceManual: true });
      expect(store.getExecution(ephemeral.executionId)).toMatchObject({ ephemeral: true, workflowId: null });
      const copy = JSON.parse(JSON.stringify(latest)) as WorkflowIR;
      await expect(runtime.executeWorkflow(copy, { ephemeral: true, forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      await expect(runtime.executeWorkflow(workflow('synthetic-unsaved-id'), { ephemeral: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      await remove(store, runtime, id);
    } finally { db.close?.(); }
  });

  it('retains revocation after a failed deletion and permits explicit reactivation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const flags: Record<string, boolean> = {};
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: flags });
    const id = 'synthetic-delete-failure';
    store.saveWorkflow(workflow(id));
    const old = store.getWorkflow(id)!;
    const executionId = store.createExecution({ workflowId: id, workflowVersion: 1, ephemeral: false });
    try {
      expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      await runtime.removeWorkflow(id);
      expect(() => store.deleteWorkflow(id)).toThrowError(expect.objectContaining({ code: 'workflow_execution_active' }));
      store.releaseWorkflowDeletion(id);
      expect(Reflect.get(store, 'workflowGenerations').size).toBe(1);
      await expect(runtime.executeWorkflow(old, { forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      runtime.setWorkflowActive(id, true);
      expect((await runtime.executeWorkflow(store.getWorkflow(id)!, { forceManual: true })).status).toBe('success');
      store.finishExecution(executionId, 'cancelled', 'synthetic_cleanup');
      await remove(store, runtime, id);
      runtime.setWorkflowActive(id, true);
      expect(Object.keys(flags)).toHaveLength(0);
    } finally { store.releaseWorkflowDeletion(id); db.close?.(); }
  });

  it('drains late active results and releases all strong owners across 40 delete/recreate cycles', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const flags: Record<string, boolean> = {};
    let entered!: () => void; let release!: () => void; let held: Promise<void>;
    const signal = new AbortController().signal;
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: flags,
      connectors: { gmail: { name: 'gmail', execute: async () => {
        entered(); await held; return { ok: true, data: [] };
      } } } });
    let running: Promise<ExecutionResult> | undefined;
    let deletion: Promise<void> | undefined;
    try {
      for (let index = 0; index < 40; index++) {
        const id = 'synthetic-active-recreated';
        const started = new Promise<void>(resolve => { entered = resolve; });
        held = new Promise<void>(resolve => { release = resolve; });
        store.saveWorkflow({ ...workflow(id), steps: [
          { type: 'action', id: 'read', connector: 'gmail', action: 'messages.search', params: { query: 'synthetic' }, sideEffect: 'NONE' },
        ] });
        const old = store.getWorkflow(id)!;
        running = runtime.executeWorkflow(old, { ephemeral: true, forceManual: true, abortSignal: signal });
        await started;
        expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
        let drained = false;
        deletion = runtime.removeWorkflow(id).then(() => { drained = true; });
        await Promise.resolve();
        expect(drained).toBe(false);
        expect(() => store.saveWorkflow(workflow(id))).toThrowError(expect.objectContaining({ code: 'workflow_deletion_in_progress' }));
        expect(() => runtime.setWorkflowActive(id, true)).toThrowError(expect.objectContaining({ code: 'workflow_deletion_in_progress' }));
        await expect(runtime.executeWorkflow(old, { forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
        release(); await deletion;
        expect((await running).status).toBe('cancelled');
        expect(store.deleteWorkflow(id)).toBe(true); store.releaseWorkflowDeletion(id);
        store.saveWorkflow(workflow(id));
        expect((await runtime.executeWorkflow(store.getWorkflow(id)!, { forceManual: true })).status).toBe('success');
        await expect(runtime.executeWorkflow(old, { ephemeral: true, forceManual: true })).rejects.toMatchObject({ code: 'workflow_removed' });
        await remove(store, runtime, id);
        expect(Object.keys(flags)).toHaveLength(0);
        expect(Reflect.get(store, 'workflowGenerations').size).toBe(0);
        expect(Reflect.get(store, 'deletingWorkflowIds').size).toBe(0);
        expect(Reflect.get(runtime, 'activeWorkflowRuns').size).toBe(0);
        expect(Reflect.get(runtime, 'workflowIdleWaiters').size).toBe(0);
        expect(getEventListeners(signal, 'abort')).toHaveLength(0);
      }
    } finally { release?.(); await deletion; await running; await runtime.waitForIdle(); db.close?.(); }
  });

  it('drains previously accepted jobs after stopAccepting', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const results: ExecutionResult[] = [];
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, onExecutionFinished: result => results.push(result) });
    try {
      runtime.enqueueEphemeralWorkflow(workflow()); runtime.enqueueEphemeralWorkflow(workflow());
      runtime.stopAccepting();
      expect(() => runtime.enqueueEphemeralWorkflow(workflow())).toThrow('runtime_stopping');
      await runtime.waitForIdle();
      expect(results.map(result => result.status)).toEqual(['success', 'success']);
      expect(Reflect.get(runtime, 'queuedExecutionCount')).toBe(0);
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });

  it('cancels an accepted old queued snapshot without running it or losing its completion', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const results: ExecutionResult[] = [];
    const read = vi.fn(async (_action: string, params: Record<string, unknown>) => {
      if (params.query === 'gate') { entered(); await held; }
      return { ok: true, data: [] };
    });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'gmail', execute: read } }, onExecutionFinished: result => results.push(result) });
    const reading = (id: string | undefined, query: string): WorkflowIR => ({ ...workflow(id), steps: [
      { type: 'action', id: 'read', connector: 'gmail', action: 'messages.search', params: { query }, sideEffect: 'NONE' },
    ] });
    const signal = new AbortController().signal;
    try {
      runtime.enqueueEphemeralWorkflow(reading(undefined, 'gate'), { abortSignal: signal });
      await started;
      const id = 'synthetic-queued';
      store.saveWorkflow(reading(id, 'old'));
      const old = store.getWorkflow(id)!;
      runtime.enqueueEphemeralWorkflow(old, { abortSignal: signal });
      await remove(store, runtime, id);
      store.saveWorkflow(reading(id, 'fresh'));
      const fresh = store.getWorkflow(id)!;
      release();
      await runtime.waitForIdle();
      expect(read.mock.calls.map(call => call[1].query)).toEqual(['gate']);
      expect(results.map(result => result.status)).toEqual(['success', 'cancelled']);
      expect(getEventListeners(signal, 'abort')).toHaveLength(0);
      expect(Reflect.get(runtime, 'queuedExecutionCount')).toBe(0);
      expect(Reflect.get(runtime, 'activeWorkflowRuns').size).toBe(0);
      expect((await runtime.executeWorkflow(fresh, { forceManual: true })).status).toBe('success');
      expect(read.mock.calls.map(call => call[1].query)).toEqual(['gate', 'fresh']);
      await remove(store, runtime, id);
    } finally { release(); await runtime.waitForIdle(); db.close?.(); }
  });
});

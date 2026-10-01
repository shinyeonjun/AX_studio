import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { WorkflowRuntime } from '../engine.js';
import type { ExecutionResult } from '../types.js';

function reading(id: string | undefined, query: string): WorkflowIR {
  return { ...(id ? { id } : {}), name: 'Synthetic admission', goal: 'Local ownership only', version: 1,
    inputs: [], steps: [{ type: 'action', id: 'read', connector: 'gmail', action: 'messages.search',
      params: { query }, sideEffect: 'NONE' }], permissions: {}, approval: [], allowExternalAuto: false,
    assumptions: [], sideEffects: {}, dataPolicy: {} };
}

async function remove(store: WorkflowStore, runtime: WorkflowRuntime, id: string) {
  expect(store.claimWorkflowDeletion(id, store.getWorkflow(id)!.version)).toBe(true);
  try { await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); }
  finally { store.releaseWorkflowDeletion(id); }
}

describe('accepted workflow ownership', () => {
  it.each(['submitted', 'reread'] as const)('never rebinds a %s snapshot when its object is reused to save a new creation', async source => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const id = 'synthetic-reused-owner';
    try {
      const submitted = reading(id, 'stale'); store.saveWorkflow(submitted);
      const snapshot = source === 'submitted' ? submitted : store.getWorkflow(id)!;
      const originalOwner = store.getWorkflowSnapshotGeneration(snapshot)!;
      await remove(store, runtime, id); store.saveWorkflow(snapshot);
      expect(store.getWorkflowSnapshotGeneration(snapshot)).toBe(originalOwner);
      const fresh = store.getWorkflow(id)!;
      expect(store.getWorkflowSnapshotGeneration(fresh)?.key).not.toBe(originalOwner.key);
      await expect(runtime.executeWorkflow(snapshot, { ephemeral: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      delete snapshot.id;
      expect(store.isWorkflowSnapshotCurrent(snapshot)).toBe(false);
      await expect(runtime.executeWorkflow(snapshot, { ephemeral: true })).rejects.toMatchObject({ code: 'workflow_removed' });
      expect(store.isWorkflowSnapshotCurrent(fresh)).toBe(true);
      await remove(store, runtime, id);
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });

  it.each([false, true])('keeps the accepted definition when the caller changes its object (saved=%s)', async saved => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    let release!: () => void; let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.fn(async (_action: string, params: Record<string, unknown>) => {
      if (params.query === 'gate') { entered(); await held; }
      return { ok: true, data: [] };
    });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'synthetic', execute: read } } });
    const id = 'synthetic-admitted-definition';
    try {
      runtime.enqueueEphemeralWorkflow(reading(undefined, 'gate')); await started;
      const original = reading(saved ? id : undefined, 'accepted');
      if (saved) store.saveWorkflow(original);
      runtime.enqueueEphemeralWorkflow(original);
      delete original.id;
      (original.steps[0] as Extract<WorkflowIR['steps'][number], { type: 'action' }>).params.query = 'mutated';
      release(); await runtime.waitForIdle();
      expect(read.mock.calls.map(call => call[1].query)).toEqual(['gate', 'accepted']);
      if (saved) await remove(store, runtime, id);
    } finally { release(); await runtime.waitForIdle(); db.close?.(); }
  });

  it('cancels the old queue job when the exact original object is saved again after recreation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    let release!: () => void; let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const results: ExecutionResult[] = [];
    const read = vi.fn(async (_action: string, params: Record<string, unknown>) => {
      if (params.query === 'gate') { entered(); await held; }
      return { ok: true, data: [] };
    });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'synthetic', execute: read } }, onExecutionFinished: result => results.push(result) });
    const id = 'synthetic-original-reference';
    const original = reading(id, 'stale');
    try {
      runtime.enqueueEphemeralWorkflow(reading(undefined, 'gate')); await started;
      store.saveWorkflow(original);
      runtime.enqueueEphemeralWorkflow(original);
      await remove(store, runtime, id);
      store.saveWorkflow(original);
      store.setWorkflowActive(id, true); runtime.setWorkflowActive(id, true);
      release(); await runtime.waitForIdle();
      expect(read.mock.calls.map(call => call[1].query)).toEqual(['gate']);
      expect(results.map(result => result.status)).toEqual(['success', 'cancelled']);
      const fresh = store.getWorkflow(id)!;
      expect((await runtime.executeWorkflow(fresh, { forceManual: true })).status).toBe('success');
      expect(read.mock.calls.map(call => call[1].query)).toEqual(['gate', 'stale']);
      await remove(store, runtime, id);
    } finally { release(); await runtime.waitForIdle(); db.close?.(); }
  });
});

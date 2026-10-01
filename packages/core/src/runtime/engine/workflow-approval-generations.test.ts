import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { WorkflowRuntime } from '../engine.js';
import type { ExecutionResult } from '../types.js';

function workflow(id: string): WorkflowIR {
  return { id, name: 'Synthetic saved approval', goal: 'Local approval ownership', version: 1,
    inputs: [], steps: [
      { type: 'human_approval', id: 'approve', reason: 'Synthetic review', forActionIds: ['first'] },
      { type: 'action', id: 'first', connector: 'gmail', action: 'message.send',
        params: { to: 'synthetic@example.invalid', body: 'first' }, sideEffect: 'EXTERNAL_HIGH' },
      { type: 'action', id: 'second', connector: 'gmail', action: 'messages.search',
        params: { query: 'synthetic' }, sideEffect: 'NONE' },
    ], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} };
}

async function remove(store: WorkflowStore, runtime: WorkflowRuntime, id: string) {
  expect(store.claimWorkflowDeletion(id, store.getWorkflow(id)!.version)).toBe(true);
  try { await runtime.removeWorkflow(id); expect(store.deleteWorkflow(id)).toBe(true); }
  finally { store.releaseWorkflowDeletion(id); }
}

describe('serialized saved workflow approval generations', () => {
  it.each(['direct', 'queued', 'new-host'] as const)('blocks an old approval after ID recreation: %s', async (mode) => {
    const db = await createDatabaseAsync(':memory:');
    let store = new WorkflowStore(db);
    const id = 'synthetic-recreated-approval';
    store.saveWorkflow(workflow(id));
    const send = vi.fn(async (action: string) => ({ ok: true, data: action === 'messages.search' ? [] : {} }));
    const results: ExecutionResult[] = [];
    const connectors = { gmail: { name: 'synthetic', execute: send } };
    let runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors,
      onExecutionFinished: result => results.push(result) });
    try {
      let first: ExecutionResult;
      if (mode === 'queued') {
        runtime.enqueueEphemeralWorkflow(store.getWorkflow(id)!); await runtime.waitForIdle(); first = results[0]!;
      } else first = await runtime.executeWorkflow(store.getWorkflow(id)!, { ephemeral: true });
      expect(first.status).toBe('pending_approval'); expect(send).not.toHaveBeenCalled();
      expect(store.getExecution(first.executionId)?.workflowId).toBeNull();
      expect(JSON.parse(store.getExecution(first.executionId)!.irJson!)._workflowGenerationKey)
        .toBe(store.getWorkflowGeneration(id)!.key);
      await remove(store, runtime, id);
      store.saveWorkflow(workflow(id));
      if (mode === 'new-host') {
        store = new WorkflowStore(db);
        runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors });
      }
      expect(await runtime.continueAfterApproval(first.pendingApprovalId!)).toMatchObject({ status: 'failed', errorCode: 'workflow_removed' });
      expect(send).not.toHaveBeenCalled();
      const fresh = await runtime.executeWorkflow(store.getWorkflow(id)!, { ephemeral: true });
      expect((await runtime.continueAfterApproval(fresh.pendingApprovalId!)).status).toBe('success');
      expect(send).toHaveBeenCalledTimes(2);
      await remove(store, runtime, id);
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });

  it('drains a resumed saved-ID one-shot and suppresses its remaining actions after removal', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const id = 'synthetic-active-approval';
    store.saveWorkflow(workflow(id));
    let entered!: () => void; let release!: () => void; let signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const calls: unknown[] = [];
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'synthetic', execute: async (_action, params, ctx) => {
        calls.push(params.body ?? 'second');
        if (params.body === 'first') { signal = ctx.abortSignal; entered(); await held; }
        return { ok: true, data: _action === 'messages.search' ? [] : {} };
      } } } });
    let resumed: Promise<ExecutionResult> | undefined; let deletion: Promise<void> | undefined;
    try {
      const first = await runtime.executeWorkflow(store.getWorkflow(id)!, { ephemeral: true });
      resumed = runtime.continueAfterApproval(first.pendingApprovalId!); await started;
      let drained = false;
      deletion = remove(store, runtime, id).then(() => { drained = true; });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(drained).toBe(false); expect(signal?.aborted).toBe(true);
      release(); await deletion;
      expect(await resumed).toMatchObject({ status: 'cancelled', errorCode: 'cancelled' });
      expect(calls).toEqual(['first']);
      expect(store.getApproval(first.pendingApprovalId!)?.status).toBe('failed');
      expect(Reflect.get(runtime, 'activeWorkflowRuns').size).toBe(0);
      expect(Reflect.get(store, 'workflowGenerations').size).toBe(0);
    } finally { release?.(); await resumed; await deletion; db.close?.(); }
  });

  it.each([false, true])('handles a legacy ID-bearing approval safely (ephemeral=%s)', async (ephemeral) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db); const id = 'synthetic-legacy-approval';
    store.saveWorkflow(workflow(id));
    const send = vi.fn(async (action: string) => ({ ok: true, data: action === 'messages.search' ? [] : {} }));
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'synthetic', execute: send } } });
    try {
      const first = await runtime.executeWorkflow(store.getWorkflow(id)!, { ephemeral });
      const snapshot = JSON.parse(store.getExecution(first.executionId)!.irJson!);
      delete snapshot._workflowGenerationKey;
      db.prepare('UPDATE executions SET ir_json = ? WHERE id = ?').run(JSON.stringify(snapshot), first.executionId);
      if (!ephemeral) expect(store.claimWorkflowDeletion(id, 1)).toBe(true);
      let result: ExecutionResult;
      try { result = await runtime.continueAfterApproval(first.pendingApprovalId!); }
      finally { store.releaseWorkflowDeletion(id); }
      expect(result, JSON.stringify(result)).toMatchObject(ephemeral ? { status: 'failed', errorCode: 'workflow_removed' } : { status: 'success' });
      expect(send).toHaveBeenCalledTimes(ephemeral ? 0 : 2);
      await remove(store, runtime, id);
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });
});

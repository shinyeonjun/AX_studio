import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../engine.js';
import type { WorkflowIR } from '../../workflow/schema.js';

const approvedWorkflow: WorkflowIR = {
  name: 'Approval lifecycle', goal: 'Synthetic delayed connector', version: 1,
  steps: [
    { type: 'human_approval', id: 'approve', reason: 'Review', forActionIds: ['send'] },
    { type: 'action', id: 'send', connector: 'gmail', action: 'message.send',
      params: { to: 'test@example.invalid', body: 'synthetic' }, sideEffect: 'EXTERNAL_HIGH' },
  ], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
};

describe('runtime resource lifecycle', () => {
  it('bounds accepted one-shot backlog without losing accepted jobs', async () => {
    const db = await createDatabaseAsync(':memory:');
    const runtime = new WorkflowRuntime({ store: new WorkflowStore(db), globalActive: true, workflowActive: {} });
    try {
      for (let i = 0; i < 128; i++) runtime.enqueueEphemeralWorkflow(approvedWorkflow);
      expect(() => runtime.enqueueEphemeralWorkflow(approvedWorkflow)).toThrow('runtime_queue_full');
    } finally { await runtime.waitForIdle(); db.close?.(); }
  });
  it('waits for an approval-resumed action before becoming idle', async () => {
    const db = await createDatabaseAsync(':memory:');
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const runtime = new WorkflowRuntime({ store: new WorkflowStore(db), globalActive: true, workflowActive: {},
      connectors: { gmail: { name: 'gmail', execute: async () => {
        entered(); await held; return { ok: true, data: {} };
      } } },
    });
    let resumed: ReturnType<WorkflowRuntime['continueAfterApproval']> | undefined;
    try {
      const first = await runtime.executeWorkflow(approvedWorkflow, { ephemeral: true });
      expect(first.status).toBe('pending_approval');
      resumed = runtime.continueAfterApproval(first.pendingApprovalId!);
      await started;
      let idle = false;
      const wait = runtime.waitForIdle().then(() => { idle = true; });
      await new Promise(resolve => setImmediate(resolve));
      expect(idle).toBe(false);
      release();
      expect((await resumed).status).toBe('success');
      await wait;
      expect(idle).toBe(true);
    } finally { release(); await resumed; db.close?.(); }
  });

  it('aborts an in-flight workflow before removing its runtime state', async () => {
    const db = await createDatabaseAsync(':memory:');
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let aborted = false;
    const workflow: WorkflowIR = {
      id: 'workflow-being-removed',
      name: 'Removable workflow', goal: 'Abort the connector', version: 1,
      steps: [
        { type: 'action', id: 'read', connector: 'gmail', action: 'messages.search',
          params: { query: 'pending' }, sideEffect: 'NONE' },
      ], permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    const runtime = new WorkflowRuntime({
      store: new WorkflowStore(db),
      globalActive: true,
      workflowActive: { [workflow.id!]: true },
      connectors: {
        gmail: {
          name: 'gmail',
          execute: async (_action, _params, ctx) => await new Promise((resolve, reject) => {
            entered();
            ctx.abortSignal?.addEventListener('abort', () => {
              aborted = true;
              reject(ctx.abortSignal?.reason ?? new DOMException('aborted', 'AbortError'));
            }, { once: true });
          }),
        },
      },
    });

    try {
      const run = runtime.executeWorkflow(workflow);
      await enteredPromise;
      await runtime.removeWorkflow(workflow.id!);

      expect(aborted).toBe(true);
      await expect(run).resolves.toMatchObject({ status: 'cancelled', errorCode: 'cancelled' });
      await expect(runtime.executeWorkflow(workflow)).resolves.toMatchObject({
        status: 'cancelled',
        errorCode: 'workflow_paused',
      });
      await expect(runtime.executeWorkflow(workflow, { forceManual: true })).rejects.toMatchObject({
        code: 'workflow_removed',
      });
    } finally {
      db.close?.();
    }
  });

  it('does not record success when a non-cooperative connector finishes after removal', async () => {
    const db = await createDatabaseAsync(':memory:');
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const workflow: WorkflowIR = {
      id: 'workflow-with-late-result',
      name: 'Late result workflow', goal: 'Reject a late connector result', version: 1,
      steps: [
        { type: 'action', id: 'read', connector: 'gmail', action: 'messages.search',
          params: { query: 'pending' }, sideEffect: 'NONE' },
      ], permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    const runtime = new WorkflowRuntime({
      store: new WorkflowStore(db),
      globalActive: true,
      workflowActive: { [workflow.id!]: true },
      connectors: {
        gmail: {
          name: 'gmail',
          execute: async () => await new Promise((resolve) => {
            entered();
            release = () => resolve({ ok: true, data: {} });
          }),
        },
      },
    });

    try {
      const run = runtime.executeWorkflow(workflow);
      await enteredPromise;
      const removal = runtime.removeWorkflow(workflow.id!);
      release();
      await removal;
      await expect(run).resolves.toMatchObject({ status: 'cancelled', errorCode: 'cancelled' });
    } finally {
      release?.();
      db.close?.();
    }
  });

  it('does not pause a workflow when a pending approval makes deletion fail', async () => {
    const db = await createDatabaseAsync(':memory:');
    const workflow = { ...approvedWorkflow, id: 'workflow-with-pending-approval' };
    const store = new WorkflowStore(db);
    store.saveWorkflow(workflow);
    const executionId = store.createExecution({
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      ephemeral: false,
    });
    store.markExecutionPending(executionId);
    const workflowActive = { [workflow.id!]: true };
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive });

    try {
      await runtime.removeWorkflow(workflow.id!);
      expect(workflowActive[workflow.id!]).toBe(true);
      expect(() => store.deleteWorkflow(workflow.id!)).toThrow('실행 중인 워크플로우는 삭제할 수 없습니다.');
    } finally {
      store.finishExecution(executionId, 'cancelled', 'test_cleanup');
      store.deleteWorkflow(workflow.id!);
      db.close?.();
    }
  });
});

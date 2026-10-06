import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { WorkflowRuntime } from './engine.js';
import { DEFAULT_APPROVAL_TTL_MS } from './recovery.js';

const workflow: WorkflowIR = {
  id: 'recovered-workflow',
  name: 'Recovered', goal: 'Restart reconciliation', version: 1, inputs: [],
  steps: [
    { type: 'human_approval', id: 'approve', reason: 'Review', forActionIds: ['send'] },
    { type: 'action', id: 'send', connector: 'gmail', action: 'message.send',
      params: { to: 'test@example.invalid', body: 'synthetic' }, sideEffect: 'EXTERNAL_HIGH' },
  ], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
};

const checkpoint = { variables: {}, stepResults: {}, remainingStepIds: [] };

async function setup() {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.saveWorkflow(workflow);
  const createRun = () => store.createExecution({ workflowId: workflow.id, workflowVersion: 1, ephemeral: false });
  return { db, store, createRun };
}

describe('startup reconciliation', () => {
  it('fails running executions that lost their runner and allows deletion afterwards', async () => {
    const { db, store, createRun } = await setup();
    const running = createRun();
    try {
      new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
      expect(store.getExecution(running)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect(store.getExecution(running)?.finishedAt).toBeTruthy();
      expect(store.deleteWorkflow(workflow.id!)).toBe(true);
    } finally { db.close?.(); }
  });

  it('fails a claimed approval with an unknown outcome and never resumes it', async () => {
    const { db, store, createRun } = await setup();
    const executionId = createRun();
    const approvalId = store.createApproval({ executionId, actionIds: ['send'], reason: 'Review', payload: { checkpoint } });
    store.markExecutionPending(executionId);
    expect(store.claimApproval(approvalId)).toBe(true);
    try {
      const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
      expect(store.getApproval(approvalId)?.status).toBe('failed');
      expect(store.getExecution(executionId)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect((await runtime.continueAfterApproval(approvalId)).errorCode).toBe('approval_already_resolved');
    } finally { db.close?.(); }
  });

  it('keeps a durable approval checkpoint resumable and closes orphaned pending executions', async () => {
    const { db, store, createRun } = await setup();
    const withCheckpoint = createRun();
    const approvalId = store.createApproval({ executionId: withCheckpoint, actionIds: ['send'], reason: 'Review', payload: { checkpoint } });
    const withoutCheckpoint = createRun();
    const partialApproval = store.createApproval({ executionId: withoutCheckpoint, actionIds: ['send'], reason: 'Review' });
    const orphan = createRun();
    store.markExecutionPending(orphan);
    try {
      new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
      expect(store.getExecution(withCheckpoint)?.status).toBe('pending_approval');
      expect(store.getApproval(approvalId)?.status).toBe('pending');
      // Without a checkpoint the remaining steps are unknown: fail closed.
      expect(store.getExecution(withoutCheckpoint)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect(store.getApproval(partialApproval)?.status).toBe('rejected');
      expect(store.getExecution(orphan)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    } finally { db.close?.(); }
  });

  it('dead-letters trigger receipts that were processing when the app stopped', async () => {
    const { db, store } = await setup();
    store.claimTriggerReceipt({ dedupeKey: 'wf:gmail.new_message:m1', workflowId: workflow.id!, triggerType: 'gmail.new_message' });
    try {
      new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
      expect(store.claimTriggerReceipt({
        dedupeKey: 'wf:gmail.new_message:m1', workflowId: workflow.id!, triggerType: 'gmail.new_message', processingLeaseMs: 1,
      })).toBe(false);
    } finally { db.close?.(); }
  });
});

describe('approval TTL', () => {
  it('expires stale pending approvals at startup and refuses to approve them', async () => {
    const { db, store } = await setup();
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: { [workflow.id!]: true },
      approvalTtlMs: DEFAULT_APPROVAL_TTL_MS,
      connectors: { gmail: { name: 'gmail', execute: async () => ({ ok: true, data: { id: 'sent' } }) } } });
    try {
      const pending = await runtime.executeWorkflow(workflow, { triggerType: 'manual' });
      expect(pending.status).toBe('pending_approval');
      const approvalId = pending.pendingApprovalId!;
      const later = Date.now() + DEFAULT_APPROVAL_TTL_MS + 60_000;

      expect(runtime.expireStaleApprovals(Date.now())).toHaveLength(0);
      expect(runtime.expireStaleApprovals(later)).toEqual([
        expect.objectContaining({ executionId: pending.executionId, status: 'cancelled', errorCode: 'approval_expired' }),
      ]);
      expect(store.getApproval(approvalId)?.status).toBe('rejected');
      expect(store.getExecution(pending.executionId)).toMatchObject({ status: 'cancelled', errorCode: 'approval_expired' });
      expect((await runtime.continueAfterApproval(approvalId)).errorCode).toBe('approval_already_resolved');
    } finally { db.close?.(); }
  });

  it('expires an approval at approve time when the sweep has not run yet', async () => {
    const { db, store } = await setup();
    const execute = async () => ({ ok: true, data: { id: 'sent' } });
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: { [workflow.id!]: true },
      approvalTtlMs: 1, connectors: { gmail: { name: 'gmail', execute } } });
    try {
      const pending = await runtime.executeWorkflow(workflow, { triggerType: 'manual' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = await runtime.continueAfterApproval(pending.pendingApprovalId!);
      expect(result).toMatchObject({ status: 'cancelled', errorCode: 'approval_expired' });
      expect(store.getApproval(pending.pendingApprovalId!)?.status).toBe('rejected');
    } finally { db.close?.(); }
  });
});

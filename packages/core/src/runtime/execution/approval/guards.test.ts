import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { WorkflowExecutionHost } from '../contracts.js';
import { prepareApprovalResume } from './guards.js';

describe('prepareApprovalResume', () => {
  const databases: Array<{ close?: () => void }> = [];

  afterEach(() => {
    for (const database of databases) database.close?.();
    databases.length = 0;
  });

  async function setup(options: { globalActive?: boolean; approvalTtlMs?: number } = {}) {
    const db = await createDatabaseAsync(':memory:');
    databases.push(db);
    const store = new WorkflowStore(db);
    const executionId = store.createExecution({ ephemeral: true });
    const approvalId = store.createApproval({ executionId, actionIds: ['send'], reason: 'send the report' });
    const notifyExecutionFinished = vi.fn();
    const host = {
      approvals: store,
      config: { store, globalActive: options.globalActive ?? true, approvalTtlMs: options.approvalTtlMs },
      toolResults: undefined,
      notifyExecutionFinished,
    } as unknown as WorkflowExecutionHost;
    return { store, host, executionId, approvalId, notifyExecutionFinished };
  }

  it('reports an unknown approval as not found', async () => {
    const { host } = await setup();
    expect(prepareApprovalResume(host, 'missing')).toEqual({
      ok: false,
      result: { executionId: '', status: 'failed', errorCode: 'approval_not_found', log: [] },
    });
  });

  it('refuses an approval that was already resolved', async () => {
    const { store, host, executionId, approvalId } = await setup();
    store.resolveApproval(approvalId, true);
    expect(prepareApprovalResume(host, approvalId)).toMatchObject({
      ok: false,
      result: { executionId, status: 'failed', errorCode: 'approval_already_resolved' },
    });
  });

  it('refuses a second resume while the first one holds the approval', async () => {
    const { host, executionId, approvalId } = await setup();
    expect(prepareApprovalResume(host, approvalId)).toMatchObject({ ok: true });
    expect(prepareApprovalResume(host, approvalId)).toMatchObject({
      ok: false,
      result: { executionId, status: 'failed', errorCode: 'approval_in_progress' },
    });
  });

  it('keeps the approval pending when the global switch is off, so it can be retried later', async () => {
    const { store, host, executionId, approvalId } = await setup({ globalActive: false });
    expect(prepareApprovalResume(host, approvalId)).toEqual({
      ok: false,
      result: { executionId, status: 'cancelled', errorCode: 'global_off_duty', log: [] },
    });
    expect(store.getApproval(approvalId)?.status).toBe('pending');
  });

  it('expires an approval past its TTL, rejects it, and notifies the finished execution', async () => {
    // A negative TTL makes every pending approval already expired, without waiting on the clock.
    const { store, host, executionId, approvalId, notifyExecutionFinished } = await setup({ approvalTtlMs: -1 });
    const outcome = prepareApprovalResume(host, approvalId);
    expect(outcome).toMatchObject({
      ok: false,
      result: { executionId, status: 'cancelled', errorCode: 'approval_expired' },
    });
    expect(store.getApproval(approvalId)?.status).toBe('rejected');
    expect(notifyExecutionFinished).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'approval_expired' }));
  });

  it('claims a pending approval and returns its approval and execution', async () => {
    const { store, host, executionId, approvalId } = await setup();
    const guard = prepareApprovalResume(host, approvalId, undefined);
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    expect(guard.approval.id).toBe(approvalId);
    expect(guard.execution.id).toBe(executionId);
    expect(store.getApproval(approvalId)?.status).toBe('processing');
  });
});

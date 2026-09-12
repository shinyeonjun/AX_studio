import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync, type AppDatabase } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('execution history retention', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  beforeEach(async () => {
    db = await createDatabaseAsync(':memory:');
    store = new WorkflowStore(db);
  });
  afterEach(() => db.close?.());

  it('clears only terminal executions and keeps pending and claimed approvals', () => {
    const running = store.createExecution({ ephemeral: true });
    const pending = store.createExecution({ ephemeral: true });
    store.markExecutionPending(pending);
    const approval = store.createApproval({ executionId: pending, actionIds: ['send'], reason: 'review' });
    const claimed = store.createExecution({ ephemeral: true });
    store.markExecutionPending(claimed);
    const processingApproval = store.createApproval({ executionId: claimed, actionIds: ['send'], reason: 'review' });
    store.claimApproval(processingApproval);
    const completed = ['success', 'failed', 'cancelled'].map((status) => {
      const id = store.createExecution({ ephemeral: true });
      store.finishExecution(id, status as 'success' | 'failed' | 'cancelled');
      return id;
    });
    const resolved = store.createApproval({ executionId: completed[0]!, actionIds: ['send'], reason: 'done' });
    store.resolveApproval(resolved, true);

    expect(store.clearExecutions()).toBe(3);
    expect(store.listExecutions().map((entry) => entry.id).sort()).toEqual([running, pending, claimed].sort());
    expect(store.getApproval(approval)?.status).toBe('pending');
    expect(store.getApproval(processingApproval)?.status).toBe('processing');
    expect(store.getApproval(resolved)).toBeUndefined();
    expect(store.clearExecutions()).toBe(0);
  });

  it('preserves pending execution state even if its approval record is missing', () => {
    const id = store.createExecution({ ephemeral: true });
    store.markExecutionPending(id);
    expect(() => store.deleteExecution(id)).toThrow(/승인 대기/);
    expect(store.clearExecutions()).toBe(0);
    expect(store.getExecution(id)?.status).toBe('pending_approval');
  });

  it('keeps a terminal record that still has an unresolved approval', () => {
    const id = store.createExecution({ ephemeral: true });
    store.finishExecution(id, 'failed');
    store.createApproval({ executionId: id, actionIds: ['send'], reason: 'legacy state' });
    expect(store.clearExecutions()).toBe(0);
    expect(() => store.deleteExecution(id)).toThrow(/승인 대기/);
  });
});

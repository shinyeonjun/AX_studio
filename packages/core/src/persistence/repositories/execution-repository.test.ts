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

  it('detects unfinished work beyond the visible history page and unresolved approvals', () => {
    const id = store.createExecution({ workflowId: 'saved-work', ephemeral: false });
    db.prepare('UPDATE executions SET started_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    for (let index = 0; index < 60; index++) {
      store.finishExecution(store.createExecution({ ephemeral: true }), 'success');
    }
    expect(store.listExecutions().some(execution => execution.id === id)).toBe(false);
    expect(store.hasUnfinishedWorkflowExecution('saved-work')).toBe(true);
    expect(store.hasUnfinishedWorkflowExecution('other-work')).toBe(false);
    store.markExecutionPending(id);
    expect(store.hasUnfinishedWorkflowExecution('saved-work')).toBe(true);
    store.finishExecution(id, 'failed');
    expect(store.hasUnfinishedWorkflowExecution('saved-work')).toBe(false);
    const approval = store.createApproval({ executionId: id, actionIds: ['send'], reason: 'legacy state' });
    expect(store.hasUnfinishedWorkflowExecution('saved-work')).toBe(true);
    store.resolveApproval(approval, false);
    expect(store.hasUnfinishedWorkflowExecution('saved-work')).toBe(false);
  });

  it('stores successful results separately from logs and clears results on failure', () => {
    const id = store.createExecution({ ephemeral: true });
    const output = { version: 1 as const, fields: [{ path: 'total', label: 'Total', valueJson: '600' }] };
    store.finishExecution(id, 'success', undefined, [], output);
    expect(store.getExecution(id)).toMatchObject({ status: 'success', logJson: '[]', output });
    store.finishExecution(id, 'failed', 'input_schema_drift', [], output);
    expect(store.getExecution(id)?.output).toBeUndefined();
    expect(db.prepare('SELECT output_json FROM executions WHERE id = ?').get(id)?.output_json).toBeNull();
  });

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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync, type AppDatabase } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import { csMailWorkflowFixture } from '../../testing/fixtures/workflows.js';

describe('execution history retention', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  beforeEach(async () => {
    db = await createDatabaseAsync(':memory:');
    store = new WorkflowStore(db);
  });
  afterEach(() => db.close?.());

  it('indexes approval lookups by execution without scanning the approval history', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM approvals
      WHERE execution_id = ? AND status IN ('pending', 'processing')`).all('execution');
    expect(plan.some(row => String(row.detail).includes('SCAN approvals'))).toBe(false);
    expect(plan.some(row => String(row.detail).includes('execution_id=?'))).toBe(true);
  });

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
    expect(store.listExecutions(50, false)[0]).toMatchObject({ hasOutput: true, output: undefined });
    store.finishExecution(id, 'failed', 'input_schema_drift', [], output);
    expect(store.getExecution(id)?.output).toBeUndefined();
    expect(db.prepare('SELECT output_json FROM executions WHERE id = ?').get(id)?.output_json).toBeNull();
  });

  it('finds each saved workflow latest execution beyond the global history page', () => {
    const { workflowId } = store.saveWorkflow(csMailWorkflowFixture);
    const id = store.createExecution({ workflowId, ephemeral: false });
    store.finishExecution(id, 'success');
    db.prepare('UPDATE executions SET started_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    for (let i = 0; i < 60; i++) store.finishExecution(store.createExecution({ ephemeral: true }), 'success');
    expect(store.listExecutions().some(row => row.id === id)).toBe(false);
    expect(store.listLatestWorkflowExecutions()).toEqual([
      { workflowId, startedAt: '2020-01-01T00:00:00.000Z', status: 'success' },
    ]);
  });

  it('appends each event once and checkpoints without duplicates across approval and recovery', () => {
    const id = store.createExecution({ ephemeral: true });
    const log = Array.from({ length: 1_000 }, (_, index) => ({ code: 'progress', index, data: 'x'.repeat(512) }));
    for (const entry of log) store.appendExecutionLog(id, entry);
    expect(db.prepare('SELECT log_json FROM executions WHERE id = ?').get(id)?.log_json).toBe('[]');
    expect(db.prepare('SELECT COUNT(*) AS count, SUM(LENGTH(entry_json)) AS bytes FROM execution_log_entries').get())
      .toMatchObject({ count: 1_000, bytes: log.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0) });
    expect(JSON.parse(store.getExecution(id)!.logJson)).toEqual(log);
    store.markExecutionPending(id, 'pending_approval', log);
    expect(db.prepare('SELECT COUNT(*) AS count FROM execution_log_entries').get()?.count).toBe(0);
    const tail = { code: 'external_effect_started' };
    store.appendExecutionLog(id, tail);
    expect(JSON.parse(store.listExecutions()[0]!.logJson)).toEqual([...log, tail]);
    store.recoverInterruptedExecutions();
    const recovered = JSON.parse(store.getExecution(id)!.logJson);
    expect(recovered.slice(0, -1)).toEqual([...log, tail]);
    expect(recovered.at(-1)).toMatchObject({ code: 'execution_interrupted' });
    store.deleteExecution(id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM execution_log_entries').get()?.count).toBe(0);
  });

  it('retains damaged checkpoint evidence and valid tail entries during recovery', () => {
    const id = store.createExecution({ ephemeral: true });
    db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run('broken history', id);
    store.appendExecutionLog(id, { code: 'external_effect_started' });
    store.recoverInterruptedExecutions();
    expect(JSON.parse(store.getExecution(id)!.logJson)).toEqual([
      expect.objectContaining({ code: 'invalid_log_checkpoint', data: { checkpoint: 'broken history' } }),
      { code: 'external_effect_started' }, expect.objectContaining({ code: 'execution_interrupted' }),
    ]);
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

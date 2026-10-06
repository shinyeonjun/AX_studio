import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync, type AppDatabase } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import { DEFAULT_HISTORY_RETENTION, pruneHistory } from './retention-repository.js';
import { appendExecutionLog, getExecution } from './execution-repository.js';

const NOW = new Date('2026-10-06T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const policy = { executionsPerWorkflow: 2, executionMinAgeDays: 90, completedReceiptMaxAgeDays: 30, workflowVersionsPerWorkflow: 2 };

describe('history retention', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  beforeEach(async () => {
    db = await createDatabaseAsync(':memory:');
    store = new WorkflowStore(db);
  });
  afterEach(() => { db.close?.(); });

  function execution(id: string, status: string, startedDaysAgo: number, workflowId: string | null = 'wf') {
    db.prepare('INSERT INTO executions (id, workflow_id, ephemeral, status, started_at, log_json) VALUES (?, ?, 0, ?, ?, ?)')
      .run(id, workflowId, status, daysAgo(startedDaysAgo), '[]');
  }

  it('removes only old, terminal executions beyond the per-workflow keep count', () => {
    execution('recent-1', 'success', 1);
    execution('recent-2', 'failed', 2);
    execution('young-beyond-rank', 'success', 10); // rank 3 but younger than 90 days
    execution('old-terminal', 'success', 200);
    execution('old-running', 'running', 201);
    execution('old-pending', 'pending_approval', 202);
    execution('old-open-approval', 'failed', 203);
    execution('old-closed-approval', 'cancelled', 204);
    execution('other-workflow-old', 'success', 300, 'wf-other');
    const open = store.createApproval({ executionId: 'old-open-approval', actionIds: ['a'], reason: 'r' });
    const closed = store.createApproval({ executionId: 'old-closed-approval', actionIds: ['a'], reason: 'r' });
    store.resolveApproval(closed, false);

    const result = pruneHistory(db, policy, NOW);

    const remaining = db.prepare('SELECT id FROM executions ORDER BY id').all().map((row) => row.id);
    expect(remaining).toEqual([
      'old-open-approval', 'old-pending', 'old-running', 'other-workflow-old', 'recent-1', 'recent-2', 'young-beyond-rank',
    ]);
    expect(result.executions).toBe(2);
    expect(store.getApproval(open)?.status).toBe('pending');
    expect(store.getApproval(closed)).toBeUndefined();
  });

  it('removes completed trigger receipts older than the window only', () => {
    const insert = db.prepare('INSERT INTO trigger_receipts (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('old-done', 'wf', 'poll', 'completed', daysAgo(40), daysAgo(40));
    insert.run('new-done', 'wf', 'poll', 'completed', daysAgo(5), daysAgo(5));
    insert.run('old-failed', 'wf', 'poll', 'failed', daysAgo(40), daysAgo(40));
    insert.run('old-processing', 'wf', 'poll', 'processing', daysAgo(40), daysAgo(40));

    expect(pruneHistory(db, policy, NOW).triggerReceipts).toBe(1);
    expect(db.prepare('SELECT dedupe_key FROM trigger_receipts ORDER BY dedupe_key').all().map((row) => row.dedupe_key))
      .toEqual(['new-done', 'old-failed', 'old-processing']);
  });

  it('keeps completed receipts for 180 days by default so a re-seen poll event cannot re-fire', () => {
    const insert = db.prepare('INSERT INTO trigger_receipts (dedupe_key, workflow_id, trigger_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('done-100d', 'wf', 'poll', 'completed', daysAgo(100), daysAgo(100));
    insert.run('done-200d', 'wf', 'poll', 'completed', daysAgo(200), daysAgo(200));

    expect(DEFAULT_HISTORY_RETENTION.completedReceiptMaxAgeDays).toBeGreaterThanOrEqual(180);
    expect(pruneHistory(db, DEFAULT_HISTORY_RETENTION, NOW).triggerReceipts).toBe(1);
    expect(db.prepare('SELECT dedupe_key FROM trigger_receipts').all().map((row) => row.dedupe_key)).toEqual(['done-100d']);
  });

  it('keeps the newest workflow versions plus versions still referenced by active work', () => {
    const base = {
      id: 'wf', name: 'wf', goal: 'g', version: 1, inputs: [], steps: [], permissions: {}, approval: [],
      allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    for (let index = 0; index < 5; index += 1) store.saveWorkflow({ ...base, goal: `g${index}` });
    db.prepare("INSERT INTO executions (id, workflow_id, workflow_version, ephemeral, status, started_at, log_json) VALUES ('run', 'wf', 2, 0, 'running', ?, '[]')")
      .run(daysAgo(0));

    expect(pruneHistory(db, policy, NOW).workflowVersions).toBe(2);
    expect(db.prepare('SELECT version FROM workflow_versions ORDER BY version').all().map((row) => row.version)).toEqual([2, 4, 5]);
    expect(store.getWorkflow('wf')?.goal).toBe('g4');
  });
});

describe('appendExecutionLog', () => {
  it('appends to the stored JSON array without rewriting it from JS', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const id = store.createExecution({ ephemeral: true });
      expect(appendExecutionLog(db, id, [{ type: 'a' }])).toBe(true);
      expect(appendExecutionLog(db, id, [{ type: 'b' }, { type: 'c', text: '한글 ]' }])).toBe(true);
      expect(appendExecutionLog(db, id, [])).toBe(true);
      const row = db.prepare('SELECT log_json FROM executions WHERE id = ?').get(id);
      expect(JSON.parse(String(row?.log_json))).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c', text: '한글 ]' }]);
      expect(getExecution(db, id)?.id).toBe(id);
      expect(appendExecutionLog(db, 'missing', [{ type: 'a' }])).toBe(false);
      db.prepare("UPDATE executions SET log_json = '{}' WHERE id = ?").run(id);
      expect(appendExecutionLog(db, id, [{ type: 'a' }])).toBe(false);
    } finally { db.close?.(); }
  });
});

import type { AppDatabase } from '../db.js';
import { persistDatabase, readRows } from '../db/types.js';

export interface HistoryRetentionPolicy {
  /** Newest executions kept per workflow (ephemeral runs share one bucket). */
  executionsPerWorkflow: number;
  /** Executions younger than this are always kept, whatever their rank. */
  executionMinAgeDays: number;
  /**
   * Completed trigger receipts older than this are removed. A receipt is the last
   * guard against re-firing an event a poll sees again, and poll cursors are not
   * comparable across connectors (seen-id lists, Slack ts, Gmail historyId, folder
   * keys), so the window is deliberately long rather than cursor-relative.
   */
  completedReceiptMaxAgeDays: number;
  /** Newest workflow versions kept per workflow. */
  workflowVersionsPerWorkflow: number;
}

export const DEFAULT_HISTORY_RETENTION: HistoryRetentionPolicy = {
  executionsPerWorkflow: 500,
  executionMinAgeDays: 90,
  completedReceiptMaxAgeDays: 180,
  workflowVersionsPerWorkflow: 50,
};

export interface HistoryPruneResult {
  executions: number;
  triggerReceipts: number;
  workflowVersions: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
// Stays well below SQLite's default 999 bind-parameter limit.
const DELETE_BATCH_SIZE = 400;

function deleteByIds(db: AppDatabase, sqlPrefix: string, ids: readonly string[]): number {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += DELETE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + DELETE_BATCH_SIZE);
    deleted += db.prepare(`${sqlPrefix} (${batch.map(() => '?').join(', ')})`).run(...batch).changes;
  }
  return deleted;
}

/**
 * Bounded history retention. An execution is removed only when it is beyond
 * the per-workflow keep count AND older than the minimum age AND terminal AND
 * has no pending/processing approval. Workflow versions referenced by an
 * active execution or an open repair proposal are always kept.
 */
export function pruneHistory(
  db: AppDatabase,
  policy: HistoryRetentionPolicy = DEFAULT_HISTORY_RETENTION,
  now: Date = new Date(),
): HistoryPruneResult {
  const executionCutoff = new Date(now.getTime() - policy.executionMinAgeDays * DAY_MS).toISOString();
  const receiptCutoff = new Date(now.getTime() - policy.completedReceiptMaxAgeDays * DAY_MS).toISOString();

  db.exec('BEGIN IMMEDIATE');
  let result: HistoryPruneResult;
  try {
    const executionIds = readRows<{ id: string }>(db.prepare(
      `WITH ranked AS (
         SELECT id, status, started_at,
                ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY started_at DESC, id DESC) AS rank
         FROM executions
       )
       SELECT id FROM ranked
       WHERE rank > ? AND started_at < ?
         AND status IN ('success', 'failed', 'cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM approvals a WHERE a.execution_id = ranked.id AND a.status IN ('pending', 'processing')
         )`,
    ), policy.executionsPerWorkflow, executionCutoff).map((row) => row.id);
    deleteByIds(db, 'DELETE FROM approvals WHERE execution_id IN', executionIds);
    const executions = deleteByIds(db, 'DELETE FROM executions WHERE id IN', executionIds);

    const triggerReceipts = db.prepare(
      "DELETE FROM trigger_receipts WHERE status = 'completed' AND updated_at < ?",
    ).run(receiptCutoff).changes;

    const versionIds = readRows<{ id: string }>(db.prepare(
      `WITH ranked AS (
         SELECT id, workflow_id, version,
                ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY version DESC) AS rank
         FROM workflow_versions
       )
       SELECT id FROM ranked
       WHERE rank > ?
         AND NOT EXISTS (
           SELECT 1 FROM executions e
           WHERE e.workflow_id = ranked.workflow_id AND e.workflow_version = ranked.version
             AND e.status IN ('running', 'pending_approval')
         )
         AND NOT EXISTS (
           SELECT 1 FROM workflow_repair_proposals p
           WHERE p.workflow_id = ranked.workflow_id AND p.base_version = ranked.version
             AND p.status = 'proposed'
         )`,
    ), policy.workflowVersionsPerWorkflow).map((row) => row.id);
    const workflowVersions = deleteByIds(db, 'DELETE FROM workflow_versions WHERE id IN', versionIds);

    db.exec('COMMIT');
    result = { executions, triggerReceipts, workflowVersions };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the retention error. */ }
    throw error;
  }
  if (result.executions + result.triggerReceipts + result.workflowVersions > 0) persistDatabase(db);
  return result;
}

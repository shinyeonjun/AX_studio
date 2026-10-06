import type { AppDatabase } from '../types.js';

function columnNames(db: AppDatabase, table: string): string[] {
  const rows = db.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name?: string }>;
  return rows.map((row) => String(row.name ?? ''));
}

/** Adds a column when absent. Table/column/type are trusted constants (DDL cannot be parameterized). */
export function addColumnIfMissing(db: AppDatabase, table: string, column: string, type: string): void {
  if (!columnNames(db, table).includes(column)) {
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
  }
}

function renameColumnIfNeeded(db: AppDatabase, table: string, from: string, to: string): void {
  const names = columnNames(db, table);
  if (names.includes(from) && !names.includes(to)) {
    db.exec('ALTER TABLE ' + table + ' RENAME COLUMN ' + from + ' TO ' + to);
  }
}

/**
 * Older writers could store the same (workflow_id, version) twice, which made
 * the unique index below fail and blocked startup. Keep the latest row of each
 * duplicate group (created_at, then rowid) so the index can be created.
 */
function dedupeWorkflowVersions(db: AppDatabase): void {
  const duplicate = db.prepare(
    'SELECT 1 AS found FROM workflow_versions GROUP BY workflow_id, version HAVING COUNT(*) > 1 LIMIT 1',
  ).get();
  if (!duplicate) return;
  const newer = columnNames(db, 'workflow_versions').includes('created_at')
    ? `(newer.created_at > workflow_versions.created_at
           OR (newer.created_at = workflow_versions.created_at AND newer.rowid > workflow_versions.rowid))`
    : 'newer.rowid > workflow_versions.rowid';
  const result = db.prepare(
    `DELETE FROM workflow_versions
     WHERE EXISTS (
       SELECT 1 FROM workflow_versions newer
       WHERE newer.workflow_id = workflow_versions.workflow_id
         AND newer.version = workflow_versions.version
         AND ${newer}
     )`,
  ).run();
  console.warn('[db] removed duplicate workflow versions before creating the unique index', { removed: result.changes });
}

export function applyLegacyMigrations(db: AppDatabase): void {
  renameColumnIfNeeded(db, 'executions', 'skill_id', 'workflow_id');
  renameColumnIfNeeded(db, 'executions', 'skill_version', 'workflow_version');
  if (!columnNames(db, 'workflows').includes('policy_json')) {
    db.exec("ALTER TABLE workflows ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!columnNames(db, 'executions').includes('ir_json')) {
    db.exec('ALTER TABLE executions ADD COLUMN ir_json TEXT');
  }
  if (!columnNames(db, 'executions').includes('workflow_id')) {
    db.exec('ALTER TABLE executions ADD COLUMN workflow_id TEXT');
  }
  if (!columnNames(db, 'executions').includes('workflow_version')) {
    db.exec('ALTER TABLE executions ADD COLUMN workflow_version INTEGER');
  }
  if (!columnNames(db, 'executions').includes('workspace_session_id')) {
    db.exec('ALTER TABLE executions ADD COLUMN workspace_session_id TEXT');
  }
  if (!columnNames(db, 'workspace_chats').includes('workflow_id')) {
    db.exec('ALTER TABLE workspace_chats ADD COLUMN workflow_id TEXT');
  }
  if (!columnNames(db, 'workspace_chats').includes('session_memo_json')) {
    db.exec("ALTER TABLE workspace_chats ADD COLUMN session_memo_json TEXT NOT NULL DEFAULT '{}'");
  }
  dedupeWorkflowVersions(db);
  db.exec([
    // Keep existing stores aligned with the fresh-schema state-query index.
    'CREATE INDEX IF NOT EXISTS idx_approvals_status_created_at ON approvals(status, created_at DESC);',
    'CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id);',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_versions_workflow_version ON workflow_versions(workflow_id, version);',
    'CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);',
    'CREATE INDEX IF NOT EXISTS idx_trigger_receipts_workflow_id ON trigger_receipts(workflow_id);',
  ].join('\n'));
  db.exec(
    "UPDATE executions SET status = 'pending_approval', finished_at = NULL, error_code = 'pending_approval' " +
      "WHERE status = 'failed' AND error_code = 'pending_approval' " +
      "AND id IN (SELECT execution_id FROM approvals WHERE status IN ('pending', 'processing'))",
  );
}

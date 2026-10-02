import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import { persistDatabase, readRow, readRows } from '../db/types.js';
import type { ExecutionRow, ExecutionStatus } from '../rows.js';
import { hasOpenApprovalForExecution } from './approval-repository.js';
import { MAX_EXECUTION_OUTPUT_JSON_LENGTH, parseExecutionOutput } from '../../contracts/execution-output.js';
import { executionHistorySchema, readHistoricalExecutionLog, type ExecutionHistoryDiagnostic } from './execution-history.js';
import { decodeSqliteJsonText } from './sqlite-json-text.js';

export function createExecution(
  db: AppDatabase,
  params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
    workspaceSessionId?: string;
  },
): string {
  const id = randomUUID();
  db
    .prepare(
      'INSERT INTO executions (id, workflow_id, workflow_version, ephemeral, status, started_at, log_json, trigger_type, ir_json, workspace_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      params.workflowId ?? null,
      params.workflowVersion ?? null,
      params.ephemeral ? 1 : 0,
      'running',
      new Date().toISOString(),
      '[]',
      params.triggerType ?? null,
      params.irJson ?? null,
      params.workspaceSessionId ?? null,
    );
  return id;
}

export function finishExecution(
  db: AppDatabase,
  id: string,
  status: Exclude<ExecutionStatus, 'running' | 'pending_approval'>,
  errorCode?: string,
  log?: unknown[],
  options?: { preserveHistory?: boolean },
) {
  if (options?.preserveHistory) {
    // Updating log_json would fire a preview trigger that deletes the raw tail.
    db.prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ? WHERE id = ?')
      .run(status, new Date().toISOString(), errorCode ?? null, id);
    persistDatabase(db);
    return;
  }
  db
    .prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ?, log_json = ? WHERE id = ?')
    .run(status, new Date().toISOString(), errorCode ?? null, JSON.stringify(log ?? []), id);
  persistDatabase(db);
}

/** Leaves the execution open so a pending approval can resume it later. */
export function markExecutionPending(
  db: AppDatabase,
  id: string,
  errorCode = 'pending_approval',
  log?: unknown[],
) {
  db
    .prepare('UPDATE executions SET status = ?, finished_at = NULL, error_code = ?, log_json = ? WHERE id = ?')
    .run('pending_approval', errorCode, JSON.stringify(log ?? []), id);
  persistDatabase(db);
}

export function updateExecutionLog(db: AppDatabase, id: string, log: unknown[]) {
  db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run(JSON.stringify(log), id);
}

export function hasPendingApprovalForWorkflow(db: AppDatabase, workflowId: string): boolean {
  const row = readRow<{ found: number }>(db.prepare(
    `SELECT 1 AS found
     FROM executions
     WHERE workflow_id = ? AND status = 'pending_approval'
     LIMIT 1`,
  ), workflowId);
  return Boolean(row?.found);
}

type HistoricalExecutionRow = Omit<ExecutionRow, 'log_json'> & {
  log_json: Uint8Array;
  output_json: Uint8Array | null;
  output_length: number | null;
  output_byte_length: number | null;
  output_present: number;
};

// SQLite length(TEXT) counts Unicode scalar values and stops at embedded NUL.
// The byte guard bounds corrupt input while retaining the preview UTF-16 contract.
const BOUNDED_OUTPUT_SQL = `CASE WHEN status = 'success'
  AND length(output_json) <= ${MAX_EXECUTION_OUTPUT_JSON_LENGTH}
  AND length(CAST(output_json AS BLOB)) <= ${MAX_EXECUTION_OUTPUT_JSON_LENGTH * 3}
  THEN CAST(output_json AS BLOB) END`;

function executionColumns(hasOutputColumn: boolean, includeOutput: boolean): string {
  return `id, workflow_id, workflow_version, ephemeral, status, started_at, finished_at,
    error_code, CAST(log_json AS BLOB) AS log_json, trigger_type, ir_json, workspace_session_id,
    ${hasOutputColumn && includeOutput ? BOUNDED_OUTPUT_SQL : 'NULL'} AS output_json,
    ${hasOutputColumn && includeOutput ? 'length(output_json)' : 'NULL'} AS output_length,
    ${hasOutputColumn && includeOutput ? 'length(CAST(output_json AS BLOB))' : 'NULL'} AS output_byte_length,
    ${hasOutputColumn ? 'output_json IS NOT NULL' : '0'} AS output_present`;
}

function outputExceedsLimit(row: Pick<HistoricalExecutionRow, 'output_json' | 'output_length' | 'output_byte_length'>): boolean {
  return Number(row.output_length) > MAX_EXECUTION_OUTPUT_JSON_LENGTH
    || Number(row.output_byte_length) > MAX_EXECUTION_OUTPUT_JSON_LENGTH * 3
    || (decodeSqliteJsonText(row.output_json)?.length ?? 0) > MAX_EXECUTION_OUTPUT_JSON_LENGTH;
}

function mapExecution(db: AppDatabase, row: HistoricalExecutionRow, schema: ReturnType<typeof executionHistorySchema>, includeOutput: boolean) {
  const history = readHistoricalExecutionLog(db, row.id, row.log_json, schema);
  const diagnostics: ExecutionHistoryDiagnostic[] = history.diagnostics;
  const hasOutput = row.status === 'success' && Boolean(row.output_present);
  const output = hasOutput && includeOutput ? parseExecutionOutput(decodeSqliteJsonText(row.output_json)) : undefined;
  if (row.output_present && row.status !== 'success') {
    diagnostics.push({ code: 'execution_output_status_mismatch', source: 'output' });
  } else if (hasOutput && includeOutput && !output) {
    diagnostics.push({ code: outputExceedsLimit(row) ? 'execution_output_limit_exceeded' : 'invalid_execution_output', source: 'output' });
  }
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    ephemeral: Boolean(row.ephemeral),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    logJson: history.logJson,
    output,
    // Presence only; bodies are validated on bounded, on-demand reads.
    hasOutput,
    historyDiagnostics: diagnostics,
    triggerType: row.trigger_type,
    irJson: row.ir_json ?? undefined,
    workspaceSessionId: row.workspace_session_id ?? undefined,
  };
}

export function getExecution(db: AppDatabase, id: string) {
  return db.readSnapshot(() => {
    const schema = executionHistorySchema(db);
    const row = readRow<HistoricalExecutionRow>(db.prepare(`SELECT ${executionColumns(schema.hasOutputColumn, true)} FROM executions WHERE id = ?`), id);
    if (!row) return undefined;
    return mapExecution(db, row, schema, true);
  });
}

/** The default list never materializes result bodies. */
export function listExecutions(db: AppDatabase, limit = 50, includeOutput = false) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('invalid_execution_limit');
  return db.readSnapshot(() => {
    const schema = executionHistorySchema(db);
    const rows = readRows<HistoricalExecutionRow>(
      db.prepare(`SELECT ${executionColumns(schema.hasOutputColumn, includeOutput)} FROM executions ORDER BY started_at DESC, id DESC LIMIT ?`), limit,
    );
    return rows.map(row => mapExecution(db, row, schema, includeOutput));
  });
}

/** Reads just the result; a large log/IR is not fetched for the lazy IPC. */
export function getExecutionOutput(db: AppDatabase, id: string) {
  return db.readSnapshot(() => readExecutionOutput(db, id));
}

function readExecutionOutput(db: AppDatabase, id: string) {
  const schema = executionHistorySchema(db);
  if (!schema.hasOutputColumn) throw new Error('execution_output_unavailable');
  const row = readRow<Pick<HistoricalExecutionRow, 'status' | 'output_length' | 'output_byte_length' | 'output_json'>>(
    db.prepare(`SELECT status, length(output_json) AS output_length,
      length(CAST(output_json AS BLOB)) AS output_byte_length, ${BOUNDED_OUTPUT_SQL} AS output_json
      FROM executions WHERE id = ?`), id);
  if (!row) throw new Error('execution_not_found');
  if (row.status !== 'success' || row.output_length === null) throw new Error('execution_output_unavailable');
  if (outputExceedsLimit(row)) throw new Error('execution_output_limit_exceeded');
  const output = parseExecutionOutput(decodeSqliteJsonText(row.output_json));
  if (!output) throw new Error('invalid_execution_output');
  return output;
}

export function deleteExecution(db: AppDatabase, id: string): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = readRow<{ id: string; status: ExecutionStatus }>(
      db.prepare('SELECT id, status FROM executions WHERE id = ?'),
      id,
    );
    if (!existing) {
      db.exec('COMMIT');
      return false;
    }
    if (hasOpenApprovalForExecution(db, id)) {
      throw new Error('승인 대기 중인 실행은 삭제할 수 없습니다.');
    }
    if (existing.status === 'running' || existing.status === 'pending_approval') {
      throw Object.assign(new Error('실행 중인 실행은 삭제할 수 없습니다.'), { code: 'execution_active' });
    }
    db.prepare('DELETE FROM approvals WHERE execution_id = ?').run(id);
    db.prepare('DELETE FROM executions WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return true;
}

export function clearExecutions(db: AppDatabase): number {
  db.exec('BEGIN');
  try {
    const terminalStatuses = "('success', 'failed', 'cancelled')";
    db.prepare(
      `DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions WHERE status IN ${terminalStatuses})`,
    ).run();
    const deleted = db.prepare(`DELETE FROM executions WHERE status IN ${terminalStatuses}`).run();
    db.exec('COMMIT');
    return deleted.changes;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

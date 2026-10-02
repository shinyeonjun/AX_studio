// Frozen writer functions from preview 0ba5e22f54cc9fe2bb777f085290bb03de5f457b.
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../../../db.js";
import type { ExecutionStatus } from "../../../rows.js";
import { parseExecutionOutput, type ExecutionOutput } from "./execution-output.fixture.js";

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
  output?: ExecutionOutput,
) {
  const outputJson = status === 'success' && output ? JSON.stringify(output) : null;
  if (outputJson && !parseExecutionOutput(outputJson)) throw new Error('invalid_execution_output');
  db
    .prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ?, log_json = ?, output_json = ? WHERE id = ?')
    .run(status, new Date().toISOString(), errorCode ?? null, JSON.stringify(log ?? []), outputJson, id);
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
}

export function updateExecutionLog(db: AppDatabase, id: string, log: unknown[]) {
  db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run(JSON.stringify(log), id);
}

export function appendExecutionLog(db: AppDatabase, id: string, entry: unknown): void {
  const json = JSON.stringify(entry);
  if (json === undefined) throw new Error('invalid_execution_log_entry');
  const result = db.prepare(`INSERT INTO execution_log_entries (execution_id, entry_json)
    SELECT id, ? FROM executions WHERE id = ?`).run(json, id);
  if (result.changes !== 1) throw new Error('execution_not_found');
}

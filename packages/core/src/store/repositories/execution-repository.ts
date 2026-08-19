import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { ExecutionRow } from '../rows.js';

export function createExecution(
  db: AppDatabase,
  params: { skillId?: string; skillVersion?: number; ephemeral: boolean; triggerType?: string },
): string {
  const id = randomUUID();
  db
    .prepare(
      'INSERT INTO executions (id, skill_id, skill_version, ephemeral, status, started_at, log_json, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      params.skillId ?? null,
      params.skillVersion ?? null,
      params.ephemeral ? 1 : 0,
      'running',
      new Date().toISOString(),
      '[]',
      params.triggerType ?? null,
    );
  return id;
}

export function finishExecution(
  db: AppDatabase,
  id: string,
  status: 'success' | 'failed' | 'cancelled',
  errorCode?: string,
  log?: unknown[],
) {
  db
    .prepare('UPDATE executions SET status = ?, finished_at = ?, error_code = ?, log_json = ? WHERE id = ?')
    .run(status, new Date().toISOString(), errorCode ?? null, JSON.stringify(log ?? []), id);
}

export function getExecution(db: AppDatabase, id: string) {
  const row = db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as ExecutionRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    ephemeral: Boolean(row.ephemeral),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    logJson: row.log_json,
    triggerType: row.trigger_type,
  };
}

export function listExecutions(db: AppDatabase, limit = 50) {
  const rows = db
    .prepare('SELECT * FROM executions ORDER BY started_at DESC LIMIT ?')
    .all(limit) as unknown as ExecutionRow[];
  return rows.map((row) => ({
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    ephemeral: Boolean(row.ephemeral),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    logJson: row.log_json,
    triggerType: row.trigger_type,
  }));
}

import type { AppDatabase } from '../db.js';
import { readRows } from '../db/types.js';

/** Checkpoints retain the legacy array; the durable tail stores each new event once. */
export function readExecutionLog(db: AppDatabase, id: string, checkpoint: string): string {
  const tail = readRows<{ entry_json: string }>(db.prepare(
    'SELECT entry_json FROM execution_log_entries WHERE execution_id = ? ORDER BY sequence',
  ), id);
  if (tail.length === 0) return checkpoint;
  let entries: unknown[];
  try {
    const parsed: unknown = JSON.parse(checkpoint);
    if (!Array.isArray(parsed)) throw new Error('invalid_execution_log');
    entries = parsed;
  } catch {
    // Retain corrupt historical bytes as evidence alongside the valid durable tail.
    entries = [{ level: 'error', code: 'invalid_log_checkpoint',
      message: '이전 실행 로그가 손상되었습니다.', data: { checkpoint } }];
  }
  return JSON.stringify([...entries, ...tail.map(row => JSON.parse(row.entry_json) as unknown)]);
}

export function appendExecutionLog(db: AppDatabase, id: string, entry: unknown): void {
  const json = JSON.stringify(entry);
  if (json === undefined) throw new Error('invalid_execution_log_entry');
  const result = db.prepare(`INSERT INTO execution_log_entries (execution_id, entry_json)
    SELECT id, ? FROM executions WHERE id = ?`).run(json, id);
  if (result.changes !== 1) throw new Error('execution_not_found');
}

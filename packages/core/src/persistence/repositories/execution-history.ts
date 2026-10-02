import type { AppDatabase } from '../db.js';
import { readRows } from '../db/types.js';
import { validateExecutionLog } from '../../runtime/execution-log.js';
import { decodeSqliteJsonText, rawSqliteJsonText } from './sqlite-json-text.js';

export interface ExecutionHistoryDiagnostic {
  code: string;
  source: 'log_checkpoint' | 'log_tail' | 'output';
  sequence?: number;
}

// Limits apply only to the legacy append-only tail, never to writes or migrations.
const MAX_TAIL_ENTRIES = 10_000;
const MAX_MERGED_LOG_LENGTH = 4_194_304;

export function executionHistorySchema(db: AppDatabase) {
  const executionColumns = db.prepare('PRAGMA table_info(executions)').all();
  const tailColumns = db.prepare('PRAGMA table_info(execution_log_entries)').all();
  return {
    hasOutputColumn: executionColumns.some(column => column.name === 'output_json'),
    hasTail: tailColumns.length > 0,
    supportedTail: ['execution_id', 'entry_json'].every(name => tailColumns.some(column => column.name === name))
      && tailColumns.some(column => column.name === 'sequence' && column.pk === 1 && column.type === 'INTEGER'),
  };
}

export function readHistoricalExecutionLog(
  db: AppDatabase,
  id: string,
  checkpointBytes: Uint8Array,
  schema: ReturnType<typeof executionHistorySchema>,
): { logJson: string; diagnostics: ExecutionHistoryDiagnostic[] } {
  const diagnostics: ExecutionHistoryDiagnostic[] = [];
  const checkpoint = decodeSqliteJsonText(checkpointBytes);
  const rawCheckpoint = rawSqliteJsonText(checkpointBytes);
  const checkpointProjection = checkpoint ?? JSON.stringify({ checkpoint: rawCheckpoint });
  let entries: ReturnType<typeof validateExecutionLog> = [];
  try { entries = validateExecutionLog(JSON.parse(checkpoint ?? 'null')); }
  catch { diagnostics.push({ code: 'invalid_log_checkpoint', source: 'log_checkpoint' }); }
  if (!schema.hasTail) return { logJson: checkpointProjection, diagnostics };
  if (!schema.supportedTail) {
    diagnostics.push({ code: 'unsupported_log_schema', source: 'log_tail' });
    return { logJson: JSON.stringify({ checkpointJson: rawCheckpoint, tailUnavailable: true }), diagnostics };
  }
  const size = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(entry_json AS BLOB))), 0) AS length
    FROM execution_log_entries WHERE execution_id = ?`).get(id);
  if (Number(size?.count) === 0) return { logJson: checkpointProjection, diagnostics };
  if (Number(size?.count) > MAX_TAIL_ENTRIES
    || Number(size?.length) + Number(size?.count) + checkpointBytes.byteLength > MAX_MERGED_LOG_LENGTH) {
    diagnostics.push({ code: 'execution_log_limit_exceeded', source: 'log_tail' });
    return { logJson: JSON.stringify({ checkpointJson: rawCheckpoint, tailUnavailable: true }), diagnostics };
  }
  const tail = readRows<{ sequence: number; entry_json: Uint8Array }>(db.prepare(
    'SELECT sequence, CAST(entry_json AS BLOB) AS entry_json FROM execution_log_entries WHERE execution_id = ? ORDER BY sequence LIMIT ?',
  ), id, MAX_TAIL_ENTRIES);
  if (!tail.length) return { logJson: checkpointProjection, diagnostics };
  for (const row of tail) {
    try {
      const json = decodeSqliteJsonText(row.entry_json);
      if (!Number.isSafeInteger(row.sequence) || row.sequence < 1 || json === undefined) {
        throw new Error('invalid_log_entry');
      }
      entries.push(...validateExecutionLog([JSON.parse(json)]));
    } catch {
      diagnostics.push({ code: 'invalid_log_entry', source: 'log_tail', sequence: row.sequence });
    }
  }
  // Corrupt history stays explicitly raw, not a fabricated normal/error log event.
  // Consumers cannot mistake an incomplete prefix for a valid resume log.
  const logJson = diagnostics.length
    ? JSON.stringify({ checkpointJson: rawCheckpoint,
      tail: tail.map(row => ({ sequence: row.sequence, entry_json: rawSqliteJsonText(row.entry_json) })) })
    : JSON.stringify(entries);
  return { logJson, diagnostics };
}

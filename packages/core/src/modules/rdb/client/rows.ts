import { openReadonlySqlite } from '../../../store/db.js';
import type { RdbConnectionConfig } from '../connector.js';
import { openRdbSqlClient } from './drivers.js';
import { quoteTableRef } from './table-ref.js';
import type { RdbRow, RdbTableRef } from './types.js';

export const MAX_RDB_RESULT_ROWS = 10_000;
export const MAX_RDB_PROBE_ROWS = MAX_RDB_RESULT_ROWS + 1;

export function normalizeRdbRowLimit(value: unknown, fallback: number): number {
  const configured = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(MAX_RDB_RESULT_ROWS, Math.max(1, configured));
}

export async function readRdbRows(
  config: RdbConnectionConfig,
  ref: RdbTableRef,
  rowLimit: number,
): Promise<RdbRow[]> {
  const limit = Math.min(Math.max(1, Math.floor(rowLimit)), MAX_RDB_PROBE_ROWS);

  if (config.type === 'sqlite' && config.filePath) {
    if (ref.schema) throw new Error('invalid_table_name');
    const db = await openReadonlySqlite(config.filePath);
    try {
      return db.all(`SELECT * FROM ${quoteTableRef(ref, '"')} LIMIT ${limit}`) as RdbRow[];
    } finally {
      db.close();
    }
  }

  const client = await openRdbSqlClient(config);
  try {
    const table = quoteTableRef(ref, config.type === 'mysql' ? '`' : '"');
    const sql = config.type === 'mysql'
      ? `SELECT * FROM ${table} LIMIT ?`
      : `SELECT * FROM ${table} LIMIT $1`;
    return await client.query(sql, [limit]);
  } finally {
    await client.close();
  }
}

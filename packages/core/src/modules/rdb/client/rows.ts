import { openReadonlySqlite } from '../../../store/db.js';
import type { RdbConnectionConfig } from '../connector.js';
import { openRdbSqlClient } from './drivers.js';
import { quoteTableRef } from './table-ref.js';
import type { RdbRow, RdbTableRef } from './types.js';

export async function readRdbRows(
  config: RdbConnectionConfig,
  ref: RdbTableRef,
  rowLimit: number,
): Promise<RdbRow[]> {
  const limit = Math.min(Math.max(1, Math.floor(rowLimit)), 10_000);

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

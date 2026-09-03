import { openReadonlySqlite } from '../../../store/db.js';
import type { RdbConnectionConfig } from '../connector.js';
import { openRdbSqlClient } from './drivers.js';
import { filterRdbTables } from './policy.js';
import type { RdbTableInfo } from './types.js';

export async function listRdbTables(config: RdbConnectionConfig): Promise<RdbTableInfo[]> {
  if (config.type === 'sqlite' && config.filePath) {
    const db = await openReadonlySqlite(config.filePath);
    try {
      const rows = db.all("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'");
      return filterRdbTables(config, rows.map((row) => ({ table: String(row.name) })));
    } finally {
      db.close();
    }
  }

  const client = await openRdbSqlClient(config);
  try {
    if (config.type === 'postgres') {
      const rows = await client.query(
        `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_type IN ('BASE TABLE', 'VIEW')
           AND table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`,
      );
      return filterRdbTables(config, rows.map((row) => ({
        schema: String(row.table_schema),
        table: String(row.table_name),
      })));
    }

    const rows = await client.query(
      `SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_type IN ('BASE TABLE', 'VIEW')
       ORDER BY table_name`,
    );
    return filterRdbTables(config, rows.map((row) => ({
      schema: String(row.schema_name),
      table: String(row.table_name),
    })));
  } finally {
    await client.close();
  }
}

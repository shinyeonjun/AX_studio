import { openReadonlySqlite } from '../../../persistence/db.js';
import { openRdbSqlClient } from './drivers.js';
import { filterRdbTables } from './policy.js';
import type { RdbConnectionConfig, RdbTableInfo } from './types.js';

/** The tables a connection is allowed to read: all Jev and workflows ever see. */
export async function listRdbTables(config: RdbConnectionConfig, abortSignal?: AbortSignal): Promise<RdbTableInfo[]> {
  return filterRdbTables(config, await discoverRdbTables(config, abortSignal));
}

/**
 * Every table and view the database shows, before any allowlist. Only for the person setting up
 * a connection, so they pick the allowed tables from a list instead of typing names.
 */
export async function discoverRdbTables(config: RdbConnectionConfig, abortSignal?: AbortSignal): Promise<RdbTableInfo[]> {
  abortSignal?.throwIfAborted();
  if (config.type === 'sqlite' && config.filePath) {
    const db = await openReadonlySqlite(config.filePath);
    try {
      abortSignal?.throwIfAborted();
      const rows = db.all("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT GLOB 'sqlite_*' ORDER BY name");
      return rows.map((row) => ({ table: String(row.name) }));
    } finally {
      db.close();
    }
  }

  const client = await openRdbSqlClient(config, abortSignal);
  try {
    if (config.type === 'postgres') {
      const rows = await client.query(
        `SELECT table_schema, table_name
         FROM information_schema.tables
         WHERE table_type IN ('BASE TABLE', 'VIEW')
           AND table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`,
      );
      return rows.map((row) => ({ schema: String(row.table_schema), table: String(row.table_name) }));
    }

    const rows = await client.query(
      `SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_type IN ('BASE TABLE', 'VIEW')
       ORDER BY table_name`,
    );
    return rows.map((row) => ({ schema: String(row.schema_name), table: String(row.table_name) }));
  } finally {
    await client.close();
  }
}

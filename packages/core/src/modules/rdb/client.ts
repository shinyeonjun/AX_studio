import { openReadonlySqlite } from '../../store/db.js';
import type { RdbConnectionConfig } from './connector.js';

export interface RdbTableRef {
  schema?: string;
  table: string;
}

export interface RdbTableInfo extends RdbTableRef {}

type QueryValue = string | number | boolean | null;
type RdbRow = Record<string, unknown>;

export interface RdbSqlClient {
  query(sql: string, values?: QueryValue[]): Promise<RdbRow[]>;
  close(): Promise<void>;
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseRdbTableRef(value: unknown): RdbTableRef | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('.');
  if (parts.length !== 1 && parts.length !== 2) return null;
  if (parts.some((part) => !IDENTIFIER_RE.test(part))) return null;
  return parts.length === 2
    ? { schema: parts[0], table: parts[1]! }
    : { table: parts[0]! };
}

export function formatRdbTableRef(ref: RdbTableRef): string {
  return ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
}

export function isAllowedRdbTable(config: RdbConnectionConfig, ref: RdbTableRef): boolean {
  const allowed = config.allowedTables ?? [];
  if (allowed.length === 0) return false;
  const formatted = formatRdbTableRef(ref);
  return allowed.some((entry) => {
    const normalized = entry.trim();
    return normalized === formatted || normalized === ref.table;
  });
}

function isAllowedSchema(config: RdbConnectionConfig, ref: RdbTableRef): boolean {
  const allowed = config.allowedSchemas ?? [];
  if (allowed.length === 0) return true;
  if (config.type === 'sqlite') return !ref.schema;
  return ref.schema ? allowed.includes(ref.schema) : false;
}

function filterTables(config: RdbConnectionConfig, tables: RdbTableInfo[]): RdbTableInfo[] {
  return tables.filter((table) => {
    if (!isAllowedSchema(config, table)) return false;
    if (!config.allowedTables?.length) return true;
    return isAllowedRdbTable(config, table);
  });
}

function quoteIdentifier(identifier: string, quote: '"' | '`'): string {
  if (!IDENTIFIER_RE.test(identifier)) throw new Error('invalid_table_name');
  return `${quote}${identifier}${quote}`;
}

function quoteTableRef(ref: RdbTableRef, quote: '"' | '`'): string {
  return ref.schema
    ? `${quoteIdentifier(ref.schema, quote)}.${quoteIdentifier(ref.table, quote)}`
    : quoteIdentifier(ref.table, quote);
}

export async function openRdbSqlClient(config: RdbConnectionConfig): Promise<RdbSqlClient> {
  if (config.type === 'postgres' && config.connectionString) {
    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: config.connectionString });
    try {
      await client.connect();
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    return {
      query: async (sql, values = []) => {
        const result = await client.query(sql, values);
        return result.rows as RdbRow[];
      },
      close: async () => {
        await client.end();
      },
    };
  }

  if (config.type === 'mysql' && config.connectionString) {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection(config.connectionString);
    return {
      query: async (sql, values = []) => {
        const [rows] = await connection.execute(sql, values);
        return (Array.isArray(rows) ? rows : []) as RdbRow[];
      },
      close: async () => {
        await connection.end();
      },
    };
  }

  throw new Error('invalid_rdb_config');
}

export async function listRdbTables(config: RdbConnectionConfig): Promise<RdbTableInfo[]> {
  if (config.type === 'sqlite' && config.filePath) {
    const db = await openReadonlySqlite(config.filePath);
    try {
      const rows = db.all("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'");
      return filterTables(config, rows.map((row) => ({ table: String(row.name) })));
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
      return filterTables(config, rows.map((row) => ({
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
    return filterTables(config, rows.map((row) => ({
      schema: String(row.schema_name),
      table: String(row.table_name),
    })));
  } finally {
    await client.close();
  }
}

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

import type { RdbConnectionConfig } from './connector.js';
import { openRdbSqlClient } from './client.js';

export interface RdbConnectionRecord {
  type?: 'mysql' | 'postgres' | 'sqlite';
  connectionString?: string;
  connectionStringStored?: boolean;
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
  label?: string;
  connectedAt?: string;
  lastError?: string;
}

export function parseRdbConnectionConfig(config: unknown): RdbConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as RdbConnectionRecord;
  const type = record.type;
  if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite') return null;

  if (type === 'sqlite') {
    const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : '';
    if (!filePath) return null;
    return {
      type,
      filePath,
      allowedSchemas: normalizeAllowedTables(record.allowedSchemas),
      allowedTables: normalizeAllowedTables(record.allowedTables),
      rowLimit: normalizeRowLimit(record.rowLimit),
    };
  }

  const connectionString =
    typeof record.connectionString === 'string' ? record.connectionString.trim() : '';
  if (!connectionString) return null;
  return {
    type,
    connectionString,
    allowedSchemas: normalizeAllowedTables(record.allowedSchemas),
    allowedTables: normalizeAllowedTables(record.allowedTables),
    rowLimit: normalizeRowLimit(record.rowLimit),
  };
}

function normalizeAllowedTables(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tables = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return tables.length > 0 ? tables : undefined;
}

function normalizeRowLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.max(1, Math.floor(value)), 10_000);
}

export function validateRdbConnectionString(
  type: 'mysql' | 'postgres',
  connectionString: string,
): string | null {
  const value = connectionString.trim();
  if (!value) return 'empty_connection_string';
  try {
    const url = new URL(value);
    if (type === 'postgres') {
      if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
        return 'invalid_postgres_connection_string';
      }
      return null;
    }
    if (url.protocol !== 'mysql:') return 'invalid_mysql_connection_string';
    return null;
  } catch {
    return 'invalid_connection_string';
  }
}

export type RdbConnectionProbeResult =
  | { ok: true }
  | { ok: false; error: string; detail?: string };

function safeProbeError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) return undefined;
  return message
    .replace(/((?:postgres(?:ql)?|mysql):\/\/)[^\s]+/gi, '$1<redacted>')
    .slice(0, 240);
}

export async function probeRdbConnection(config: RdbConnectionConfig): Promise<RdbConnectionProbeResult> {
  if (config.type === 'sqlite' && config.filePath) {
    try {
      const { openReadonlySqlite } = await import('../../store/db.js');
      const db = await openReadonlySqlite(config.filePath);
      try {
        db.all("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
      } finally {
        db.close();
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'sqlite_file_unreadable' };
    }
  }

  if ((config.type === 'postgres' || config.type === 'mysql') && config.connectionString) {
    const formatError = validateRdbConnectionString(config.type, config.connectionString);
    if (formatError) {
      return { ok: false, error: formatError };
    }
    let client: Awaited<ReturnType<typeof openRdbSqlClient>> | undefined;
    try {
      client = await openRdbSqlClient(config);
      await client.query('SELECT 1');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: config.type === 'mysql' ? 'mysql_connection_failed' : 'postgres_connection_failed',
        detail: safeProbeError(error),
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  return { ok: false, error: 'invalid_rdb_config' };
}

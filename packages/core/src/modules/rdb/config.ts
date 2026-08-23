import type { RdbConnectionConfig } from './connector.js';

export interface RdbConnectionRecord {
  type?: 'postgres' | 'sqlite';
  connectionString?: string;
  filePath?: string;
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
  if (type !== 'postgres' && type !== 'sqlite') return null;

  if (type === 'sqlite') {
    const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : '';
    if (!filePath) return null;
    return {
      type,
      filePath,
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
  return Math.min(Math.floor(value), 10_000);
}

export async function probeRdbConnection(config: RdbConnectionConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  if (config.type === 'sqlite' && config.filePath) {
    try {
      const { openReadonlySqlite } = await import('../../store/db.js');
      const db = await openReadonlySqlite(config.filePath);
      db.all("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
      db.close();
      return { ok: true };
    } catch {
      return { ok: false, error: 'sqlite_file_unreadable' };
    }
  }

  if (config.type === 'postgres' && config.connectionString) {
    try {
      const pg = await import('pg');
      const client = new pg.default.Client({ connectionString: config.connectionString });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return { ok: true };
    } catch {
      return { ok: false, error: 'postgres_connection_failed' };
    }
  }

  return { ok: false, error: 'invalid_rdb_config' };
}

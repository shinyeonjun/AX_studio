import type { RdbConnectionConfig } from '../connector.js';
import type { RdbConnectionRecord } from './contracts.js';

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

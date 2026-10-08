import type { RdbConnectionConfig } from '../client/types.js';
import type { RdbConnectionRecord } from './contracts.js';
import { parseRdbConnectionConfig } from './parse.js';

/** The id a single, pre-multi-database connection becomes; also the first database added. */
export const DEFAULT_RDB_DATABASE_ID = 'default';

/**
 * One database of the 'rdb' connection as stored: what it is and how it is limited, never its
 * connection string (that lives in the OS secret store, keyed by `id`). `schema` is the saved
 * table/relation summary the read catalog offers to Jev.
 */
export interface RdbDatabaseEntry {
  id: string;
  label?: string;
  /** Absent only in metadata-only records (catalog fixtures); opening a database needs it. */
  type?: 'mysql' | 'postgres' | 'sqlite';
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
  connectionStringStored?: boolean;
  schema?: unknown;
  connectedAt?: string;
  lastError?: string;
}

/** A database the connector can open: its stored entry plus a usable connection config. */
export type RdbDatabase = RdbConnectionConfig & { id: string; label?: string };

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function entryFromRecord(value: unknown, fallbackId: string): RdbDatabaseEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as RdbConnectionRecord & { id?: unknown; schema?: unknown };
  const type = record.type === 'mysql' || record.type === 'postgres' || record.type === 'sqlite' ? record.type : undefined;
  if (record.type !== undefined && !type) return null;
  const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : '';
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : undefined;
  return {
    id,
    ...(label ? { label } : {}),
    ...(type ? { type } : {}),
    ...(filePath ? { filePath } : {}),
    ...(strings(record.allowedSchemas) ? { allowedSchemas: strings(record.allowedSchemas) } : {}),
    ...(strings(record.allowedTables) ? { allowedTables: strings(record.allowedTables) } : {}),
    ...(typeof record.rowLimit === 'number' ? { rowLimit: record.rowLimit } : {}),
    ...(record.connectionStringStored === true ? { connectionStringStored: true } : {}),
    ...(record.schema !== undefined ? { schema: record.schema } : {}),
    ...(typeof record.connectedAt === 'string' ? { connectedAt: record.connectedAt } : {}),
    ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
  };
}

function records(config: unknown): Array<{ value: unknown; fallbackId: string }> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const databases = (config as { databases?: unknown }).databases;
  if (Array.isArray(databases) && databases.length > 0) {
    return databases.map((value, index) => ({ value, fallbackId: index === 0 ? DEFAULT_RDB_DATABASE_ID : `rdb-${index + 1}` }));
  }
  // A connection saved before several databases were possible is the one, default database.
  return [{ value: config, fallbackId: DEFAULT_RDB_DATABASE_ID }];
}

function unique<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)));
}

/** The databases of an 'rdb' connection row, as stored (no credentials needed). */
export function rdbDatabaseEntries(config: unknown): RdbDatabaseEntry[] {
  return unique(records(config).map(({ value, fallbackId }) => entryFromRecord(value, fallbackId)).filter((entry): entry is RdbDatabaseEntry => entry !== null));
}

/**
 * The databases that can be opened: a stored entry whose credentials were merged in (a
 * connection string for MySQL/PostgreSQL). Entries still missing theirs are left out.
 */
export function parseRdbDatabases(config: unknown): RdbDatabase[] {
  return unique(records(config).flatMap(({ value, fallbackId }) => {
    const entry = entryFromRecord(value, fallbackId);
    const parsed = parseRdbConnectionConfig(value);
    return entry && parsed ? [{ ...parsed, id: entry.id, ...(entry.label ? { label: entry.label } : {}) }] : [];
  }));
}

/** The stored row for a list of databases. Connection strings are never written here. */
export function serializeRdbDatabases(entries: readonly RdbDatabaseEntry[]): Record<string, unknown> {
  return {
    databases: entries.map((entry) => {
      const stored: Record<string, unknown> = { ...entry };
      delete stored.connectionString;
      return stored;
    }),
  };
}

/** Adds a database, or updates the one with the same id (keeping its id). */
export function upsertRdbDatabase(config: unknown, entry: RdbDatabaseEntry): RdbDatabaseEntry[] {
  const entries = rdbDatabaseEntries(config);
  const index = entries.findIndex((current) => current.id === entry.id);
  if (index < 0) return [...entries, entry];
  entries[index] = { ...entries[index], ...entry, id: entries[index]!.id };
  return entries;
}

export function removeRdbDatabase(config: unknown, id: string): RdbDatabaseEntry[] {
  return rdbDatabaseEntries(config).filter((entry) => entry.id !== id.trim());
}

/**
 * The database a read names: by exact id, then by a unique label (case-insensitive). Without a
 * name, the only database, else the default one. Ambiguous or unknown names match nothing.
 */
export function matchRdbDatabase<T extends { id: string; label?: string }>(databases: readonly T[], connectionId?: string): T | undefined {
  const needle = connectionId?.trim();
  if (!needle) {
    if (databases.length === 1) return databases[0];
    return databases.find((entry) => entry.id === DEFAULT_RDB_DATABASE_ID);
  }
  const exact = databases.find((entry) => entry.id === needle);
  if (exact) return exact;
  const lowered = needle.toLowerCase();
  const byLabel = databases.filter((entry) => entry.label?.toLowerCase() === lowered);
  return byLabel.length === 1 ? byLabel[0] : undefined;
}

/** The name people know a database by: its label, else its kind and file or "기본 DB". */
export function rdbDatabaseName(entry: { id: string; label?: string; type?: string; filePath?: string }): string {
  if (entry.label) return entry.label;
  const kind = entry.type === 'sqlite' ? 'SQLite' : entry.type === 'postgres' ? 'PostgreSQL' : entry.type === 'mysql' ? 'MySQL' : 'DB';
  const file = entry.filePath ? entry.filePath.split(/[\\/]/u).pop() : undefined;
  return file ? `${kind} ${file}` : entry.id === DEFAULT_RDB_DATABASE_ID ? '기본 DB' : `${kind} (${entry.id})`;
}

/**
 * A database table as a work-discovery source id: "rdb:orders" for the default database (the
 * id format before several databases), "rdb:<databaseId>/orders" for any other.
 */
export function rdbSourceId(databaseId: string, table: string): string {
  return databaseId === DEFAULT_RDB_DATABASE_ID ? `rdb:${table}` : `rdb:${databaseId}/${table}`;
}

export function parseRdbSourceId(sourceId: string): { databaseId: string; table: string } | undefined {
  if (!sourceId.startsWith('rdb:')) return undefined;
  const rest = sourceId.slice(4);
  const slash = rest.indexOf('/');
  return slash > 0
    ? { databaseId: rest.slice(0, slash), table: rest.slice(slash + 1) }
    : { databaseId: DEFAULT_RDB_DATABASE_ID, table: rest };
}

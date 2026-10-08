import {
  DEFAULT_RDB_DATABASE_ID,
  parseRdbDatabases,
  rdbDatabaseEntries,
  type RdbDatabase,
  type RdbDatabaseEntry,
} from '@ax-studio/core';
import { readRdbSecrets, type RdbDatabaseSecrets } from './secrets.js';

/**
 * A connection string kept in the row itself, as connections saved before the OS secret store
 * did. Only the flat (single database) row had one; it belongs to the default database.
 */
export function legacyPlaintextConnectionString(config: unknown): string | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const record = config as Record<string, unknown>;
  if (Array.isArray(record.databases)) return undefined;
  return typeof record.connectionString === 'string' && record.connectionString.trim()
    ? record.connectionString.trim()
    : undefined;
}

/** The stored databases with each one's connection string merged in (never persisted). */
export function mergeRdbSecrets(
  entries: readonly RdbDatabaseEntry[],
  secrets: RdbDatabaseSecrets,
): { databases: Array<RdbDatabaseEntry & { connectionString?: string }> } {
  return {
    databases: entries.map((entry) => {
      const connectionString = entry.type === 'sqlite' ? undefined : secrets[entry.id]?.connectionString;
      return connectionString ? { ...entry, connectionString } : { ...entry };
    }),
  };
}

/** The databases the connector can open now: SQLite files, and the others whose secret is stored. */
export function openableRdbDatabases(entries: readonly RdbDatabaseEntry[], secrets: RdbDatabaseSecrets): RdbDatabase[] {
  return parseRdbDatabases(mergeRdbSecrets(entries, secrets));
}

function withPlaintextFallback(config: unknown, secrets: RdbDatabaseSecrets): RdbDatabaseSecrets {
  const plaintext = legacyPlaintextConnectionString(config);
  return plaintext && !secrets[DEFAULT_RDB_DATABASE_ID]
    ? { ...secrets, [DEFAULT_RDB_DATABASE_ID]: { connectionString: plaintext } }
    : secrets;
}

/**
 * Resolves the persisted metadata with the encrypted connection strings: `{ databases: [...] }`
 * with each database's connection string merged, ready for core `parseRdbDatabases`.
 */
export async function resolveRdbConnectionConfig(config: unknown): Promise<Record<string, unknown> | null> {
  const entries = rdbDatabaseEntries(config).filter((entry) => entry.type !== undefined);
  if (entries.length === 0) return null;
  const needsSecrets = entries.some((entry) => entry.type !== 'sqlite');
  const secrets = withPlaintextFallback(config, needsSecrets ? await readRdbSecrets() : {});
  return mergeRdbSecrets(entries, secrets);
}

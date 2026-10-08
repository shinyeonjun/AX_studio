import {
  DEFAULT_RDB_DATABASE_ID,
  rdbDatabaseEntries,
  serializeRdbDatabases,
  summarizeRdbSchema,
  upsertRdbDatabase,
  type RdbDatabase,
  type RdbDatabaseEntry,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { applyRdbConnector } from './apply.js';
import { legacyPlaintextConnectionString } from './config.js';
import { withRdbConnectionLock } from './lock.js';
import { readRdbSecretState, writeRdbSecrets } from './secrets.js';

export async function hydrateRdbConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const opened = await withRdbConnectionLock(async () => {
    const connection = store.getConnections().find((entry) => entry.connector === 'rdb');
    if (!connection?.connected) return undefined;
    let entries = rdbDatabaseEntries(connection.config).filter((entry) => entry.type !== undefined);
    if (entries.length === 0) {
      store.setConnection('rdb', false);
      return undefined;
    }

    const { secrets, legacy } = await readRdbSecretState();
    // A connection saved before the OS secret store kept its address in the row: move it out.
    const plaintext = legacyPlaintextConnectionString(connection.config);
    if (plaintext && !secrets[DEFAULT_RDB_DATABASE_ID]) {
      secrets[DEFAULT_RDB_DATABASE_ID] = { connectionString: plaintext };
    }
    if (plaintext) {
      entries = entries.map((entry) => entry.id === DEFAULT_RDB_DATABASE_ID && entry.type !== 'sqlite'
        ? { ...entry, connectionStringStored: true }
        : entry);
    }
    // The single pre-multi-database secret becomes the default database's entry in the map.
    if (plaintext || legacy) await writeRdbSecrets(secrets);

    // Persisting always writes `{ databases: [...] }`, so a flat row is converted here once.
    const databases = applyRdbConnector(store, runtime, entries, secrets);
    return { databases, entries };
  });
  if (!opened) return;

  // Connections saved before relations were read get them once, without delaying startup.
  const withoutSchema = new Map(opened.entries.filter((entry) => entry.schema === undefined).map((entry) => [entry.id, entry]));
  for (const database of opened.databases) {
    const entry = withoutSchema.get(database.id);
    if (entry) void fillRdbSchema(store, database, entry);
  }
}

export async function fillRdbSchema(store: WorkflowStore, database: RdbDatabase, read: RdbDatabaseEntry): Promise<void> {
  const schema = await summarizeRdbSchema(database).catch(() => undefined);
  if (!schema) return;
  await withRdbConnectionLock(async () => {
    const current = store.getConnections().find((entry) => entry.connector === 'rdb');
    if (!current?.connected) return;
    const saved = rdbDatabaseEntries(current.config).find((entry) => entry.id === database.id);
    if (!saved || saved.schema !== undefined) return;
    // Reconnected meanwhile (another file, address or other tables): that connect read its own schema.
    const same = (key: 'type' | 'filePath' | 'allowedTables' | 'allowedSchemas' | 'connectedAt') =>
      JSON.stringify(saved[key] ?? null) === JSON.stringify(read[key] ?? null);
    if (!same('type') || !same('filePath') || !same('allowedTables') || !same('allowedSchemas') || !same('connectedAt')) return;
    store.setConnection('rdb', true, serializeRdbDatabases(upsertRdbDatabase(current.config, { ...saved, schema })));
  });
}

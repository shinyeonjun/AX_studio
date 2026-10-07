import { RdbConnector, summarizeRdbSchema, type WorkflowRuntime, type WorkflowStore } from '@ax-studio/core';
import { getRdbConnectionString, saveRdbConnectionString } from './secrets.js';
import { persistedRdbConfig, resolveRdbConnectionConfig } from './config.js';

export async function hydrateRdbConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'rdb');
  if (!connection?.connected) return;

  const metadata = (connection.config ?? {}) as Record<string, unknown>;
  const storedConnectionString = await getRdbConnectionString();
  const parsed = await resolveRdbConnectionConfig(connection.config);
  if (!parsed) {
    store.setConnection('rdb', false);
    return;
  }

  if (parsed.type !== 'sqlite' && typeof metadata.connectionString === 'string') {
    if (!storedConnectionString) {
      await saveRdbConnectionString(metadata.connectionString);
    }
    store.setConnection('rdb', true, {
      ...persistedRdbConfig(parsed),
      ...(metadata.schema ? { schema: metadata.schema } : {}),
      label: typeof metadata.label === 'string' ? metadata.label : undefined,
      connectedAt: typeof metadata.connectedAt === 'string' ? metadata.connectedAt : undefined,
      lastError: typeof metadata.lastError === 'string' ? metadata.lastError : undefined,
    });
  }

  runtime.setConnector('rdb', new RdbConnector(parsed));
  // Connections saved before relations were read get them once, without delaying startup.
  if (!metadata.schema) void fillRdbSchema(store, parsed);
}

async function fillRdbSchema(store: WorkflowStore, config: Parameters<typeof summarizeRdbSchema>[0]): Promise<void> {
  const schema = await summarizeRdbSchema(config).catch(() => undefined);
  const current = store.getConnections().find((entry) => entry.connector === 'rdb');
  if (!schema || !current?.connected) return;
  // Reconnected meanwhile (another file or other tables): that connect read its own schema.
  const saved = (current.config ?? {}) as Record<string, unknown>;
  const same = (key: 'type' | 'filePath' | 'allowedTables' | 'allowedSchemas') => JSON.stringify(saved[key] ?? null) === JSON.stringify(config[key] ?? null);
  if (!same('type') || !same('filePath') || !same('allowedTables') || !same('allowedSchemas')) return;
  store.setConnection('rdb', true, { ...(current.config ?? {}), schema });
}

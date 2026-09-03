import { RdbConnector, type WorkflowRuntime, type WorkflowStore } from '@ax-studio/core';
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
      label: typeof metadata.label === 'string' ? metadata.label : undefined,
      connectedAt: typeof metadata.connectedAt === 'string' ? metadata.connectedAt : undefined,
      lastError: typeof metadata.lastError === 'string' ? metadata.lastError : undefined,
    });
  }

  runtime.setConnector('rdb', new RdbConnector(parsed));
}

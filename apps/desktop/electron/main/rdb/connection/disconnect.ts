import { removeRdbDatabase, type WorkflowRuntime, type WorkflowStore } from '@ax-studio/core';
import { applyRdbConnector } from './apply.js';
import { withRdbConnectionLock } from './lock.js';
import { readRdbSecrets, writeRdbSecrets } from './secrets.js';

/** Removes one database (with its stored connection string), or every one without an id. */
export function disconnectRdb(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  databaseId?: string,
): Promise<void> {
  return withRdbConnectionLock(async () => {
    const id = databaseId?.trim();
    const connection = store.getConnections().find((entry) => entry.connector === 'rdb');
    const remaining = id ? removeRdbDatabase(connection?.config, id) : [];
    const secrets = id ? await readRdbSecrets() : {};
    if (id) delete secrets[id];
    await writeRdbSecrets(remaining.length === 0 ? {} : secrets);
    applyRdbConnector(store, runtime, remaining, secrets);
  });
}

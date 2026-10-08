import {
  RdbConnector,
  serializeRdbDatabases,
  type RdbDatabase,
  type RdbDatabaseEntry,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { openableRdbDatabases } from './config.js';
import type { RdbDatabaseSecrets } from './secrets.js';

/**
 * Persists the database list (never a connection string) and points the connector at every
 * database that can be opened. A missing OS secret degrades to "not usable" instead of
 * silently erasing that database; the connection reads as connected while one is usable.
 */
export function applyRdbConnector(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  entries: RdbDatabaseEntry[],
  secrets: RdbDatabaseSecrets,
): RdbDatabase[] {
  const openable = openableRdbDatabases(entries, secrets);
  const config = entries.length > 0 ? serializeRdbDatabases(entries) : undefined;
  if (openable.length === 0) {
    store.setConnection('rdb', false, config);
    runtime.setConnector('rdb', null);
    return openable;
  }
  store.setConnection('rdb', true, config);
  runtime.setConnector('rdb', new RdbConnector(openable));
  return openable;
}

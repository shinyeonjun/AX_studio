import { buildJevReadOperationIndex, RdbConnector, withOpenRdbDatabases, type Connector, type JevReadOperationIndex } from '@ax-studio/core';

type JevOperationConnections = Parameters<typeof buildJevReadOperationIndex>[0];

const jevOperationIndexCache = new WeakMap<object, {
  revision: number;
  index: JevReadOperationIndex;
}>();

/**
 * The saved connections as chat may read them: databases the RDB connector cannot open (address
 * missing from this computer's secure storage) are left out, so Jev never picks a read that can
 * only fail. Settings still lists them as "다시 연결 필요".
 */
export function readableConnections<T extends { connector: string; connected: boolean; config?: unknown }>(
  connections: readonly T[],
  rdbConnector: Connector | undefined,
): T[] {
  const open = new Set(rdbConnector instanceof RdbConnector ? rdbConnector.databaseIds : []);
  return withOpenRdbDatabases(connections, open);
}

/** Reuses the read catalog index while the store's connection revision is unchanged. */
export function selectJevReadOperations(
  store: object,
  revision: number | undefined,
  connections: JevOperationConnections,
  userMessage: string,
) {
  const cached = revision === undefined ? undefined : jevOperationIndexCache.get(store);
  if (!cached || cached.revision !== revision) {
    const index = buildJevReadOperationIndex(connections);
    if (revision !== undefined) jevOperationIndexCache.set(store, { revision, index });
    return index.select(userMessage);
  }
  return cached.index.select(userMessage);
}

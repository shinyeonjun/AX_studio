import { buildJevReadOperationIndex, type JevReadOperationIndex } from '@ax-studio/core';

type JevOperationConnections = Parameters<typeof buildJevReadOperationIndex>[0];

const jevOperationIndexCache = new WeakMap<object, {
  revision: number;
  index: JevReadOperationIndex;
}>();

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

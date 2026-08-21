import { CONNECTOR_CATALOG, CONNECTOR_IDS } from '@ax-studio/core';

/** Connectors that need no user connection and have a real runtime implementation. */
const BUILTIN_CONNECTORS = CONNECTOR_IDS.filter((id) => {
  const entry = CONNECTOR_CATALOG[id];
  return entry.runtimeAvailable && entry.alwaysReal && entry.connectionKind === 'builtin';
});

export function connectedConnectorIds(store: {
  getConnections: () => Array<{ connector: string; connected: boolean }>;
}): string[] {
  const connected = store.getConnections().filter((c) => c.connected).map((c) => c.connector);
  return [...new Set([...connected, ...BUILTIN_CONNECTORS])];
}

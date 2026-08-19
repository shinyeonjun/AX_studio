import { getCore } from '../core-instance.js';

const BUILTIN_CONNECTORS = ['document', 'local_sheet'];

export function connectedConnectorIds(store: {
  getConnections: () => Array<{ connector: string; connected: boolean }>;
}): string[] {
  const connected = store.getConnections().filter((c) => c.connected).map((c) => c.connector);
  return [...new Set([...connected, ...BUILTIN_CONNECTORS])];
}

export { BUILTIN_CONNECTORS };

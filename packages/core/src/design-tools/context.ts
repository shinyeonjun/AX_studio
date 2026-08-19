import type { ConnectionRecord, DesignToolContext } from './types.js';

export function buildDesignToolContext(
  connections: ConnectionRecord[],
  connectedConnectorIds: string[],
): DesignToolContext {
  return { connections, connectedConnectorIds };
}

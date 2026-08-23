import type { Connector } from '../modules/types.js';
import type { ConnectionRecord, DesignToolContext } from './types.js';

export interface DesignToolContextOptions {
  allowUntrustedData?: boolean;
  connectors?: Record<string, Connector>;
}

export function buildDesignToolContext(
  connections: ConnectionRecord[],
  connectedConnectorIds: string[],
  options: DesignToolContextOptions & { connectors?: Record<string, Connector> } = {},
): DesignToolContext {
  return {
    connections,
    connectedConnectorIds,
    allowUntrustedData: options.allowUntrustedData === true,
    connectors: options.connectors,
  };
}

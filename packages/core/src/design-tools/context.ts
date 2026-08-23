import type { Connector } from '../modules/types.js';
import type { ConnectionRecord, DesignToolContext } from './types.js';
import type { InteractionMode } from '../platform/mode-policy.js';

export interface DesignToolContextOptions {
  allowUntrustedData?: boolean;
  interactionMode?: InteractionMode;
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
    interactionMode: options.interactionMode,
    allowUntrustedData: options.allowUntrustedData === true,
    connectors: options.connectors,
  };
}

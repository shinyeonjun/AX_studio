import type { Connector } from '../modules/types.js';
import type { ConnectionRecord, DesignToolContext } from './types.js';
import type { InteractionMode } from '../platform/mode-policy.js';

export interface DesignToolContextOptions {
  allowUntrustedData?: boolean;
  interactionMode?: InteractionMode;
  workflowActions?: DesignToolContext['workflowActions'];
  connectors?: Record<string, Connector>;
}

export function buildDesignToolContext(
  connections: ConnectionRecord[],
  connectedConnectorIds: string[],
  workflow?: DesignToolContext['workflow'],
  options: DesignToolContextOptions & { connectors?: Record<string, Connector> } = {},
): DesignToolContext {
  return {
    connections,
    connectedConnectorIds,
    workflow,
    interactionMode: options.interactionMode,
    workflowActions: options.workflowActions,
    allowUntrustedData: options.allowUntrustedData === true,
    connectors: options.connectors,
  };
}

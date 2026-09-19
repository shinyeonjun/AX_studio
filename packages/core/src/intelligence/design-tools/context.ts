import type { Connector } from '../../connectors/types.js';
import type { ConnectionRecord, DesignToolContext } from './types.js';
import type { DiscoveryMetadataRecord } from '../../contracts/discovery-metadata.js';

export interface DesignToolContextOptions {
  allowUntrustedData?: boolean;
  capabilityResultMode?: DesignToolContext['capabilityResultMode'];
  connectors?: Record<string, Connector>;
  discoveryMetadata?: readonly DiscoveryMetadataRecord[];
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
    capabilityResultMode: options.capabilityResultMode ?? 'model_evidence',
    connectors: options.connectors,
    discoveryMetadata: options.discoveryMetadata,
  };
}

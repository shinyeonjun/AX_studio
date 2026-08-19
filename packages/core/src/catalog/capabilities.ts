export {
  CapabilityParamSchema,
  CapabilityRiskSchema,
  ConnectorCapabilitySchema,
  type CapabilityParam,
  type ConnectorCapability,
  type ConnectorConnection,
} from './capability-types.js';

export {
  CAPABILITY_CATALOG,
  getCapability,
  getCapabilitiesForConnector,
} from '../modules/packages/catalog.js';

import { getCapability } from '../modules/packages/catalog.js';
import type { ConnectorConnection } from './capability-types.js';

export function checkRequiredConnections(
  requiredCapabilityIds: string[],
  connections: ConnectorConnection[],
): { missing: string[] } {
  const connectedConnectors = new Set(
    connections.filter((connection) => connection.connected).map((connection) => connection.connector),
  );
  const missing: string[] = [];
  for (const capId of requiredCapabilityIds) {
    const cap = getCapability(capId);
    if (!cap) continue;
    if (!connectedConnectors.has(cap.connector) && !missing.includes(cap.connector)) {
      missing.push(cap.connector);
    }
  }
  return { missing };
}

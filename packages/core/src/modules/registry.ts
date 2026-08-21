import type { WorkflowStore } from '../store/workflow-store.js';
import type { Connector } from './types.js';
import { CONNECTOR_CATALOG, type ConnectorId } from '../catalog/connectors.js';
import { instantiateRegisteredConnector } from './module-registry.js';
import './register-defaults.js';

export { registerModule, type ModuleRegistration } from './module-registry.js';

export function createAlwaysRealConnectors(): Record<string, Connector> {
  const connectors: Record<string, Connector> = {};
  for (const id of Object.keys(CONNECTOR_CATALOG) as ConnectorId[]) {
    if (CONNECTOR_CATALOG[id].alwaysReal) {
      const instance = instantiateConnector(id);
      if (instance) connectors[id] = instance;
    }
  }
  return connectors;
}

export function instantiateConnector(id: ConnectorId, config?: Record<string, unknown>): Connector | null {
  return instantiateRegisteredConnector(id, config);
}

export function buildConnectorsFromStore(store: WorkflowStore): Record<string, Connector> {
  // Production runtime must never silently execute against test connectors.
  // Tests construct WorkflowRuntime with its explicit mock defaults instead.
  const connectors = createAlwaysRealConnectors();

  for (const conn of store.getConnections()) {
    if (!conn.connected || !conn.config) continue;
    const entry = CONNECTOR_CATALOG[conn.connector as ConnectorId];
    if (!entry) continue;
    const instance = instantiateConnector(conn.connector as ConnectorId, conn.config);
    if (instance) connectors[conn.connector] = instance;
  }

  return connectors;
}

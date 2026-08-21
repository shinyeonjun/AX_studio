import { CONNECTOR_CATALOG, CONNECTOR_IDS, type ConnectorId } from '../../catalog/connectors.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

const BUILTIN_CONNECTORS = new Set<ConnectorId>(
  CONNECTOR_IDS.filter(
    (id) => CONNECTOR_CATALOG[id].runtimeAvailable && CONNECTOR_CATALOG[id].alwaysReal,
  ),
);

export const connectionsList: DesignToolHandler = (ctx) => {
  const byConnector = new Map(ctx.connections.map((entry) => [entry.connector, entry]));

  return CONNECTOR_IDS.map((id) => {
    const catalog = CONNECTOR_CATALOG[id];
    const record = byConnector.get(id);
    const connected = BUILTIN_CONNECTORS.has(id) || Boolean(record?.connected);
    return {
      connector: id,
      label: catalog.label,
      connected,
      connectable: catalog.connectable,
      description: catalog.description,
    };
  });
};

export function filterConnectedConnectorIds(ctx: DesignToolContext): string[] {
  return ctx.connectedConnectorIds;
}

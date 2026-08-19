import { getCapabilitiesForConnector } from './capabilities.js';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
} from '../modules/packages/catalog-data.js';
import type { ConnectorCatalogEntry, ConnectorId } from './connector-types.js';

export { CONNECTOR_IDS };
export type { ConnectorCatalogEntry, ConnectorId, ConnectorConnectionKind } from './connector-types.js';

export { CONNECTOR_CATALOG };

export const CONNECTABLE_CONNECTOR_IDS = CONNECTOR_IDS.filter(
  (id) => CONNECTOR_CATALOG[id].connectable,
) as ConnectorId[];

export function getConnectorCatalogEntry(id: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG[id as ConnectorId];
}

export function getConnectorLabel(id: string): string {
  return CONNECTOR_CATALOG[id as ConnectorId]?.label ?? id;
}

export function getConnectorEmoji(id: string): string {
  return CONNECTOR_CATALOG[id as ConnectorId]?.emoji ?? '⚙️';
}

export function listConnectorCapabilities(id: ConnectorId): string[] {
  return getCapabilitiesForConnector(id).map((cap) => cap.id);
}

import { findDynamicCapability, listDynamicCapabilities } from '../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry, ConnectorId } from '../../catalog/connector-types.js';
import { CONNECTOR_IDS } from '../../catalog/connector-types.js';
import { DOCUMENT_CAPABILITIES, DOCUMENT_CATALOG } from '../document/catalog.js';
import { GMAIL_CAPABILITIES, GMAIL_CATALOG } from '../gmail/catalog.js';
import { HTTP_CAPABILITIES, HTTP_CATALOG } from '../http/catalog.js';
import { LOCAL_FOLDER_CAPABILITIES, LOCAL_FOLDER_CATALOG } from '../local-folder/catalog.js';
import { LOCAL_SHEET_CAPABILITIES, LOCAL_SHEET_CATALOG } from '../local-sheet/catalog.js';
import { RDB_CAPABILITIES, RDB_CATALOG } from '../rdb/catalog.js';
import { SLACK_CAPABILITIES, SLACK_CATALOG } from '../slack/catalog.js';
import { TRANSFORM_CAPABILITIES, TRANSFORM_CATALOG } from '../transform/catalog.js';
import { WEBHOOK_CAPABILITIES, WEBHOOK_CATALOG } from '../webhook/catalog.js';

export {
  DOCUMENT_CAPABILITIES,
  DOCUMENT_CATALOG,
  GMAIL_CAPABILITIES,
  GMAIL_CATALOG,
  HTTP_CAPABILITIES,
  HTTP_CATALOG,
  LOCAL_FOLDER_CAPABILITIES,
  LOCAL_FOLDER_CATALOG,
  LOCAL_SHEET_CAPABILITIES,
  LOCAL_SHEET_CATALOG,
  RDB_CAPABILITIES,
  RDB_CATALOG,
  SLACK_CAPABILITIES,
  SLACK_CATALOG,
  TRANSFORM_CAPABILITIES,
  TRANSFORM_CATALOG,
  WEBHOOK_CAPABILITIES,
  WEBHOOK_CATALOG,
};

export { CONNECTOR_IDS };

export const CAPABILITY_CATALOG: ConnectorCapability[] = [
  ...GMAIL_CAPABILITIES,
  ...SLACK_CAPABILITIES,
  ...LOCAL_FOLDER_CAPABILITIES,
  ...DOCUMENT_CAPABILITIES,
  ...RDB_CAPABILITIES,
  ...LOCAL_SHEET_CAPABILITIES,
  ...TRANSFORM_CAPABILITIES,
  ...HTTP_CAPABILITIES,
  ...WEBHOOK_CAPABILITIES,
];

export const CONNECTOR_CATALOG: Record<ConnectorId, ConnectorCatalogEntry> = {
  gmail: GMAIL_CATALOG,
  slack: SLACK_CATALOG,
  local_folder: LOCAL_FOLDER_CATALOG,
  document: DOCUMENT_CATALOG,
  rdb: RDB_CATALOG,
  local_sheet: LOCAL_SHEET_CATALOG,
  transform: TRANSFORM_CATALOG,
  http: HTTP_CATALOG,
  webhook: WEBHOOK_CATALOG,
};

export function getCapability(id: string): ConnectorCapability | undefined {
  return findDynamicCapability(id) ?? CAPABILITY_CATALOG.find((capability) => capability.id === id);
}

export function getCapabilitiesForConnector(connector: string): ConnectorCapability[] {
  const dynamic = listDynamicCapabilities().filter((capability) => capability.connector === connector);
  const staticCaps = CAPABILITY_CATALOG.filter((capability) => capability.connector === connector);
  const seen = new Set<string>();
  return [...dynamic, ...staticCaps].filter((cap) => {
    if (seen.has(cap.id)) return false;
    seen.add(cap.id);
    return true;
  });
}

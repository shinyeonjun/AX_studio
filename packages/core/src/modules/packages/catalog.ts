import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry, ConnectorId } from '../../catalog/connector-types.js';
import { CONNECTOR_IDS } from '../../catalog/connector-types.js';
import type { ModulePackage } from '../module-package.js';
import type { PushTriggerDriver } from '../module-package.js';
import { documentModulePackage } from './document.js';
import { gmailModulePackage } from './gmail.js';
import { localFolderModulePackage } from './local-folder.js';
import { localSheetModulePackage } from './local-sheet.js';
import { rdbModulePackage } from './rdb.js';
import { slackModulePackage } from './slack.js';
import { transformModulePackage } from './transform.js';

export const ALL_MODULE_PACKAGES: ModulePackage[] = [
  gmailModulePackage,
  slackModulePackage,
  localFolderModulePackage,
  documentModulePackage,
  rdbModulePackage,
  localSheetModulePackage,
  transformModulePackage,
];

export { CONNECTOR_IDS };

export const CAPABILITY_CATALOG: ConnectorCapability[] = ALL_MODULE_PACKAGES.flatMap(
  (pkg) => pkg.capabilities,
);

export const CONNECTOR_CATALOG: Record<ConnectorId, ConnectorCatalogEntry> = Object.fromEntries(
  ALL_MODULE_PACKAGES.map((pkg) => [pkg.id, pkg.catalog]),
) as Record<ConnectorId, ConnectorCatalogEntry>;

export const PUSH_TRIGGER_DRIVERS: PushTriggerDriver[] = ALL_MODULE_PACKAGES.flatMap((pkg) =>
  pkg.pushTriggerDriver ? [pkg.pushTriggerDriver] : [],
);

export function getCapability(id: string): ConnectorCapability | undefined {
  return CAPABILITY_CATALOG.find((capability) => capability.id === id);
}

export function getCapabilitiesForConnector(connector: string): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter((capability) => capability.connector === connector);
}

export function getModulePackage(id: string): ModulePackage | undefined {
  return ALL_MODULE_PACKAGES.find((pkg) => pkg.id === id);
}

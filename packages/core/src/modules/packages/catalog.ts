import type { ModulePackage } from '../module-package.js';
import type { PushTriggerDriver } from '../module-package.js';
import { documentModulePackage } from './document.js';
import { gmailModulePackage } from './gmail.js';
import { localFolderModulePackage } from './local-folder.js';
import { localSheetModulePackage } from './local-sheet.js';
import { rdbModulePackage } from './rdb.js';
import { slackModulePackage } from './slack.js';
import { transformModulePackage } from './transform.js';
import { httpModulePackage } from './http.js';
import { webhookModulePackage } from './webhook.js';

export {
  CAPABILITY_CATALOG,
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  getCapability,
  getCapabilitiesForConnector,
} from './catalog-data.js';

export const ALL_MODULE_PACKAGES: ModulePackage[] = [
  gmailModulePackage,
  slackModulePackage,
  localFolderModulePackage,
  documentModulePackage,
  rdbModulePackage,
  localSheetModulePackage,
  transformModulePackage,
  httpModulePackage,
  webhookModulePackage,
];

export const PUSH_TRIGGER_DRIVERS: PushTriggerDriver[] = ALL_MODULE_PACKAGES.flatMap((pkg) =>
  pkg.pushTriggerDriver ? [pkg.pushTriggerDriver] : [],
);

export function getModulePackage(id: string): ModulePackage | undefined {
  return ALL_MODULE_PACKAGES.find((pkg) => pkg.id === id);
}

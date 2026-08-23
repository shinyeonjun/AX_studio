import type { ModulePackage } from '../module-package.js';
import { LocalSheetConnector } from '../local-sheet/index.js';
import { localSheetDiscoverySource } from '../local-sheet/discovery-source.js';
import { readWorkbookFromPath } from '../local-sheet/read.js';
import { LOCAL_SHEET_CAPABILITIES, LOCAL_SHEET_CATALOG } from '../local-sheet/catalog.js';

export const localSheetModulePackage: ModulePackage = {
  id: 'local_sheet',
  catalog: LOCAL_SHEET_CATALOG,
  capabilities: LOCAL_SHEET_CAPABILITIES,
  registration: {
    instantiate: () => new LocalSheetConnector(),
  },
  discoverySource: localSheetDiscoverySource,
  materializeWorkbook: readWorkbookFromPath,
};

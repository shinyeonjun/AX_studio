import type { ModulePackage } from '../module-package.js';
import { LOCAL_SHEET_CAPABILITIES, LOCAL_SHEET_CATALOG } from './catalog-data.js';

export const localSheetModulePackage: ModulePackage = {
  id: 'local_sheet',
  catalog: LOCAL_SHEET_CATALOG,
  capabilities: LOCAL_SHEET_CAPABILITIES,
  registration: {
  },
};

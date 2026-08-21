import type { ModulePackage } from '../module-package.js';
import { DocumentConnector } from '../document/index.js';
import { DOCUMENT_CAPABILITIES, DOCUMENT_CATALOG } from './catalog-data.js';

export const documentModulePackage: ModulePackage = {
  id: 'document',
  catalog: DOCUMENT_CATALOG,
  capabilities: DOCUMENT_CAPABILITIES,
  registration: {
    instantiate: () => new DocumentConnector(),
  },
};

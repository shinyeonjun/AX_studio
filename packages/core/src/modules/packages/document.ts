import type { ModulePackage } from '../module-package.js';
import { MockDocumentConnector } from '../mocks/index.js';
import { DocumentConnector } from '../document/index.js';
import { DOCUMENT_CAPABILITIES, DOCUMENT_CATALOG } from './catalog-data.js';

export const documentModulePackage: ModulePackage = {
  id: 'document',
  catalog: DOCUMENT_CATALOG,
  capabilities: DOCUMENT_CAPABILITIES,
  registration: {
    createMock: () => new MockDocumentConnector(),
    instantiate: () => new DocumentConnector(),
  },
};

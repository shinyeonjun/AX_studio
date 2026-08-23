import type { ModulePackage } from '../module-package.js';
import { TransformConnector } from '../transform/index.js';
import { TRANSFORM_CAPABILITIES, TRANSFORM_CATALOG } from '../transform/catalog.js';

export const transformModulePackage: ModulePackage = {
  id: 'transform',
  catalog: TRANSFORM_CATALOG,
  capabilities: TRANSFORM_CAPABILITIES,
  registration: {
    instantiate: () => new TransformConnector(),
  },
};

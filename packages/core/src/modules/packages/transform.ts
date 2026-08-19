import type { ModulePackage } from '../module-package.js';
import { TransformConnector } from '../transform/index.js';
import { TRANSFORM_CAPABILITIES, TRANSFORM_CATALOG } from './catalog-data.js';

export const transformModulePackage: ModulePackage = {
  id: 'transform',
  catalog: TRANSFORM_CATALOG,
  capabilities: TRANSFORM_CAPABILITIES,
  registration: {
    createMock: () => new TransformConnector(),
    instantiate: () => new TransformConnector(),
  },
};

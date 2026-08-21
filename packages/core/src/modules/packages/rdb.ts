import type { ModulePackage } from '../module-package.js';
import { RdbConnector, type RdbConnectionConfig } from '../rdb/index.js';
import { RDB_CAPABILITIES, RDB_CATALOG } from './catalog-data.js';

export const rdbModulePackage: ModulePackage = {
  id: 'rdb',
  catalog: RDB_CATALOG,
  capabilities: RDB_CAPABILITIES,
  registration: {
    instantiate: (config) => (config ? new RdbConnector(config as unknown as RdbConnectionConfig) : null),
  },
};

import type { ModulePackage } from '../module-package.js';
import { RdbConnector, type RdbConnectionConfig } from '../rdb/index.js';
import { rdbDiscoverySource } from '../rdb/discovery-source.js';
import { RDB_CAPABILITIES, RDB_CATALOG } from '../rdb/catalog.js';

export const rdbModulePackage: ModulePackage = {
  id: 'rdb',
  catalog: RDB_CATALOG,
  capabilities: RDB_CAPABILITIES,
  registration: {
    instantiate: (config) => (config ? new RdbConnector(config as unknown as RdbConnectionConfig) : null),
  },
  discoverySource: rdbDiscoverySource,
};

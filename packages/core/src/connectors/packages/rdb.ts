import type { ModulePackage } from '../module-package.js';
import { RdbConnector } from '../rdb/index.js';
import { parseRdbDatabases } from '../rdb/config/databases.js';
import { rdbDiscoverySource } from '../rdb/discovery-source.js';
import { RDB_CAPABILITIES, RDB_CATALOG } from '../rdb/catalog.js';

export const rdbModulePackage: ModulePackage = {
  id: 'rdb',
  catalog: RDB_CATALOG,
  capabilities: RDB_CAPABILITIES,
  registration: {
    // Every database whose credentials are present; none usable means no connector.
    instantiate: (config) => {
      const databases = parseRdbDatabases(config);
      return databases.length > 0 ? new RdbConnector(databases) : null;
    },
  },
  discoverySource: rdbDiscoverySource,
};

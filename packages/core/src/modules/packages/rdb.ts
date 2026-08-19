import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ModulePackage } from '../module-package.js';
import { MockRdbConnector } from '../mocks/index.js';
import { RdbConnector, type RdbConnectionConfig } from '../rdb/index.js';

const RDB_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'rdb.schema.describe',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 스키마',
    description: 'DB 스키마 조회',
    sideEffect: 'NONE',
    params: [{ name: 'connectionId', label: 'DB 연결', question: '어떤 DB에 연결할까요?', required: true }],
  },
  {
    id: 'rdb.query.read',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 조회',
    description: '읽기 전용 SQL 조회',
    sideEffect: 'NONE',
    params: [
      { name: 'connectionId', label: 'DB 연결', question: '어떤 DB에 연결할까요?', required: true },
      { name: 'sql', label: '쿼리', question: '어떤 조회를 할까요?', required: false },
    ],
    io: { inputs: {}, outputs: { rows: 'TableArtifact' } },
  },
];

export const rdbModulePackage: ModulePackage = {
  id: 'rdb',
  catalog: {
    id: 'rdb',
    label: 'DB',
    description: 'SQLite/PostgreSQL 읽기',
    connectable: false,
    alwaysReal: false,
    connectionKind: 'config',
    emoji: '🗄️',
  },
  capabilities: RDB_CAPABILITIES,
  registration: {
    createMock: () => new MockRdbConnector(),
    instantiate: (config) => (config ? new RdbConnector(config as unknown as RdbConnectionConfig) : null),
  },
};

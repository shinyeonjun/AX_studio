import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const RDB_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'rdb.schema.describe',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 스키마',
    description: '허용된 테이블 목록 조회',
    sideEffect: 'NONE',
    params: [],
  },
  {
    id: 'rdb.query.read',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 조회',
    description: '허용된 테이블에서 읽기 전용 조회',
    sideEffect: 'NONE',
    params: [{ name: 'table', label: '테이블', question: '어떤 테이블을 조회할까요?', required: true }],
    io: { inputs: {}, outputs: { rows: 'TableArtifact' } },
  },
];

export const RDB_CATALOG: ConnectorCatalogEntry = {
  id: 'rdb',
  label: 'DB',
  description: 'SQLite/PostgreSQL 읽기',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'config',
  emoji: '🗄️',
};

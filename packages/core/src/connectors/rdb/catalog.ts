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
    description: '허용된 테이블에서 읽기 전용 페이지 조회. truncated=true 또는 completeness.hasMore=true이면 같은 table/limit과 nextOffset으로 계속 조회합니다.',
    sideEffect: 'NONE',
    params: [
      { name: 'table', label: '테이블', question: '어떤 테이블을 조회할까요?', required: true },
      { name: 'offset', label: '시작 위치', question: '몇 번째 행부터 읽을까요?', required: false },
      { name: 'limit', label: '페이지 크기', question: '한 번에 최대 몇 행을 읽을까요?', required: false },
    ],
    io: { inputs: {}, outputs: { rows: 'TableArtifact' } },
  },
];

export const RDB_CATALOG: ConnectorCatalogEntry = {
  id: 'rdb',
  label: 'DB',
  description: 'SQLite/PostgreSQL/MySQL 읽기',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'config',
  emoji: '🗄️',
};

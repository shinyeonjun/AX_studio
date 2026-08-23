import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const TRANSFORM_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'transform.evaluate',
    connector: 'transform',
    kind: 'read',
    label: '변환식 평가',
    description: '검증된 TransformExpr를 결정론적으로 평가',
    sideEffect: 'NONE',
    params: [{ name: 'expr', label: '변환식', question: '변환식', required: true }],
    io: { inputs: { table: 'TableArtifact' }, outputs: { value: 'JsonArtifact' } },
  },
  {
    id: 'transform.table_to_text',
    connector: 'transform',
    kind: 'read',
    label: '표 → 텍스트',
    description: '표 데이터를 텍스트로 변환',
    sideEffect: 'NONE',
    params: [],
    io: { inputs: { table: 'TableArtifact' }, outputs: { text: 'TextArtifact' } },
  },
  {
    id: 'transform.document_to_text',
    connector: 'transform',
    kind: 'read',
    label: '문서 → 텍스트',
    description: '문서 아티팩트에서 텍스트 추출',
    sideEffect: 'NONE',
    params: [],
    io: { inputs: { document: 'DocumentArtifact' }, outputs: { text: 'TextArtifact' } },
  },
];

export const TRANSFORM_CATALOG: ConnectorCatalogEntry = {
  id: 'transform',
  label: 'Transform',
  description: '데이터 계약 변환 (테이블·문서 → 텍스트)',
  connectable: false,
  alwaysReal: true,
  runtimeAvailable: true,
  connectionKind: 'builtin',
  emoji: '🔀',
};

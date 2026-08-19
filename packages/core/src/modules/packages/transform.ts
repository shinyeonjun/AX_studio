import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ModulePackage } from '../module-package.js';
import { TransformConnector } from '../transform/index.js';

const TRANSFORM_CAPABILITIES: ConnectorCapability[] = [
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

export const transformModulePackage: ModulePackage = {
  id: 'transform',
  catalog: {
    id: 'transform',
    label: 'Transform',
    description: '데이터 계약 변환 (테이블·문서 → 텍스트)',
    connectable: false,
    alwaysReal: true,
    connectionKind: 'builtin',
    emoji: '🔀',
  },
  capabilities: TRANSFORM_CAPABILITIES,
  registration: {
    createMock: () => new TransformConnector(),
    instantiate: () => new TransformConnector(),
  },
};

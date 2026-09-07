import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const LOCAL_SHEET_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'local_sheet.read',
    connector: 'local_sheet',
    kind: 'read',
    label: '시트 읽기',
    description: 'CSV/xlsx 읽기',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '파일 경로', question: '파일 경로를 알려주세요.', required: true }],
    io: { inputs: {}, outputs: { sheet: 'TableArtifact' } },
  },
];

export const LOCAL_SHEET_CATALOG: ConnectorCatalogEntry = {
  id: 'local_sheet',
  label: 'Sheets',
  description: '로컬 CSV/xlsx 읽기',
  connectable: false,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'builtin',
  emoji: '📊',
};

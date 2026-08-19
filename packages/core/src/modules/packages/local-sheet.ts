import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ModulePackage } from '../module-package.js';
import { MockLocalSheetConnector } from '../mocks/index.js';

const LOCAL_SHEET_CAPABILITIES: ConnectorCapability[] = [
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

export const localSheetModulePackage: ModulePackage = {
  id: 'local_sheet',
  catalog: {
    id: 'local_sheet',
    label: 'Sheets',
    description: '로컬 CSV/xlsx 읽기',
    connectable: false,
    alwaysReal: false,
    connectionKind: 'builtin',
    emoji: '📊',
  },
  capabilities: LOCAL_SHEET_CAPABILITIES,
  registration: {
    createMock: () => new MockLocalSheetConnector(),
  },
};

import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const LOCAL_FOLDER_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'local_folder.new_file',
    connector: 'local_folder',
    kind: 'trigger',
    label: '새 파일',
    description: '연결 폴더에 새 파일이 생기면 업무 시작',
    params: [
      { name: 'folderId', label: '연결 폴더', question: '어떤 폴더를 감시할까요?', required: true },
      {
        name: 'extensions',
        label: '파일 형식',
        question: '어떤 확장자만 감시할까요? (예: .pdf,.docx)',
        required: false,
      },
    ],
    io: { inputs: {}, outputs: { file: 'FileRef' } },
  },
  {
    id: 'local_folder.list',
    connector: 'local_folder',
    kind: 'read',
    label: '폴더 목록',
    description: '연결 폴더의 파일 목록 조회',
    sideEffect: 'NONE',
    params: [{ name: 'folderId', label: '폴더', question: '어떤 연결 폴더를 볼까요?', required: false }],
  },
  {
    id: 'local_folder.read',
    connector: 'local_folder',
    kind: 'read',
    label: '파일 읽기',
    description: '연결 폴더의 파일 읽기',
    sideEffect: 'NONE',
    params: [
      { name: 'folderId', label: '폴더', question: '어떤 연결 폴더인가요?', required: false },
      { name: 'path', label: '파일 경로', question: '어떤 파일을 읽을까요?', required: true },
    ],
    io: { inputs: { file: 'FileRef' }, outputs: { file: 'FileRef' } },
  },
];

export const LOCAL_FOLDER_CATALOG: ConnectorCatalogEntry = {
  id: 'local_folder',
  label: '로컬 폴더',
  description: '내 PC 폴더를 문서·파일 소스로 연결 · 새 파일 트리거',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'config',
  emoji: '📁',
};

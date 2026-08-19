import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ModulePackage } from '../module-package.js';
import { MockLocalFolderConnector } from '../mocks/index.js';
import {
  LocalFolderConnector,
  getLocalFolderConnectionStatus,
  parseLocalFolderConnectionConfig,
} from '../local-folder/index.js';
import { buildLocalFolderResources } from '../../interview/connected-resources.js';
import { localFolderNewFileHandler } from '../../triggers/local-folder/new-file/index.js';
import type { DesignToolContext } from '../../design-tools/types.js';

function localFolderSources(ctx: DesignToolContext) {
  const conn = ctx.connections.find((entry) => entry.connector === 'local_folder');
  const status = getLocalFolderConnectionStatus(conn?.config, Boolean(conn?.connected));
  if (!status.connected) {
    return { connector: 'local_folder', connected: false, sources: [] };
  }
  return {
    connector: 'local_folder',
    connected: true,
    sources: status.folders.map((folder) => ({
      id: folder.id,
      label: folder.label,
      kind: 'local_folder',
      path: folder.path,
      addedAt: folder.addedAt,
    })),
  };
}

function localFolderSourceFiles(ctx: DesignToolContext, args: Record<string, unknown>) {
  const folderId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
  if (!folderId) throw new Error('folderId_required');

  const conn = ctx.connections.find((entry) => entry.connector === 'local_folder');
  const status = getLocalFolderConnectionStatus(conn?.config, Boolean(conn?.connected));
  const folder = status.folders.find((entry) => entry.id === folderId);
  if (!folder) throw new Error('folder_not_found');

  const extensions = Array.isArray(args.extensions)
    ? args.extensions.filter((item): item is string => typeof item === 'string')
    : typeof args.extensions === 'string' && args.extensions.trim()
      ? args.extensions.split(',').map((item) => item.trim()).filter(Boolean)
      : undefined;

  const scanned = buildLocalFolderResources([folder], { extensions, maxFilesPerFolder: 100 })[0]!;
  return {
    folderId: folder.id,
    label: folder.label,
    path: folder.path,
    files: scanned.files,
    totalFileCount: scanned.totalFileCount,
    truncated: scanned.truncated,
  };
}

const LOCAL_FOLDER_CAPABILITIES: ConnectorCapability[] = [
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

export const localFolderModulePackage: ModulePackage = {
  id: 'local_folder',
  catalog: {
    id: 'local_folder',
    label: '로컬 폴더',
    description: '내 PC 폴더를 문서·파일 소스로 연결 · 새 파일 트리거',
    connectable: true,
    alwaysReal: false,
    connectionKind: 'config',
    emoji: '📁',
  },
  capabilities: LOCAL_FOLDER_CAPABILITIES,
  registration: {
    createMock: () => new MockLocalFolderConnector(),
    instantiate: (config) => {
      const parsed = parseLocalFolderConnectionConfig(config);
      if (parsed && parsed.folders.length > 0) return new LocalFolderConnector(parsed);
      return null;
    },
  },
  triggerHandlers: [localFolderNewFileHandler],
  listSources: localFolderSources,
  listSourceFiles: localFolderSourceFiles,
};

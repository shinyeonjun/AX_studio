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
import { LOCAL_FOLDER_CAPABILITIES, LOCAL_FOLDER_CATALOG } from './catalog-data.js';

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

export const localFolderModulePackage: ModulePackage = {
  id: 'local_folder',
  catalog: LOCAL_FOLDER_CATALOG,
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

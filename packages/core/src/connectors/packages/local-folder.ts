import type { ModulePackage } from '../module-package.js';
import {
  LocalFolderConnector,
  getLocalFolderConnectionStatus,
  parseLocalFolderConnectionConfig,
} from '../local-folder/index.js';
import { resolveFolderRoot } from '../local-folder/path-security.js';
import { localFolderNewFileHandler } from '../../triggers/local-folder/new-file/index.js';
import type { DesignToolContext } from '../../intelligence/design-tools/types.js';
import { LOCAL_FOLDER_CAPABILITIES, LOCAL_FOLDER_CATALOG } from '../local-folder/catalog.js';
import { folderPage, parseFolderPage } from '../local-folder/pagination.js';
import { scanFolderCheckedAsync } from '../local-folder/scan-async.js';

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
      accessible: resolveFolderRoot(folder.path).ok,
      addedAt: folder.addedAt,
    })),
  };
}

async function localFolderSourceFiles(ctx: DesignToolContext, args: Record<string, unknown>) {
  ctx.abortSignal?.throwIfAborted();
  const folderId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
  if (!folderId) throw new Error('folderId_required');

  const conn = ctx.connections.find((entry) => entry.connector === 'local_folder');
  if (!conn?.connected) throw new Error('local_folder_not_connected');
  const status = getLocalFolderConnectionStatus(conn?.config, Boolean(conn?.connected));
  const folder = status.folders.find((entry) => entry.id === folderId);
  if (!folder) throw new Error('folder_not_found');

  const extensions = Array.isArray(args.extensions)
    ? args.extensions.filter((item): item is string => typeof item === 'string')
    : typeof args.extensions === 'string' && args.extensions.trim()
      ? args.extensions.split(',').map((item) => item.trim()).filter(Boolean)
      : undefined;

  const page = parseFolderPage(args.offset, args.limit ?? 20);
  if (!page || page.limit < 1 || page.limit > 20) throw new Error('invalid_folder_pagination');
  const result = await scanFolderCheckedAsync(folder.path, extensions, ctx.abortSignal);
  ctx.abortSignal?.throwIfAborted();
  if (!result.ok) throw new Error(result.errorCode);
  const scanned = folderPage(result.files, page);
  return {
    folderId: folder.id,
    label: folder.label,
    path: folder.path,
    files: scanned.files.map(file => ({ filePath: file.filePath, fileName: file.fileName, extension: file.extension })),
    totalFileCount: scanned.totalFileCount,
    truncated: scanned.truncated,
    offset: scanned.offset,
    limit: scanned.limit,
    totalFileCountIsExact: scanned.totalFileCountIsExact,
    scanLimitReached: scanned.scanLimitReached,
    hasMore: scanned.hasMore,
    nextOffset: scanned.nextOffset,
    completeness: scanned.completeness,
  };
}

export const localFolderModulePackage: ModulePackage = {
  id: 'local_folder',
  catalog: LOCAL_FOLDER_CATALOG,
  capabilities: LOCAL_FOLDER_CAPABILITIES,
  registration: {
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

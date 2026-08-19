import { buildLocalFolderResources } from '../../interview/connected-resources.js';
import { getLocalFolderConnectionStatus } from '../../modules/local-folder/index.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extensionsArg(args: Record<string, unknown>): string[] | undefined {
  const raw = args.extensions;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

export const sourcesFilesList: DesignToolHandler = (ctx, args) => {
  const folderId = stringArg(args, 'folderId');
  if (!folderId) {
    throw new Error('folderId_required');
  }

  const conn = ctx.connections.find((entry) => entry.connector === 'local_folder');
  const status = getLocalFolderConnectionStatus(conn?.config, Boolean(conn?.connected));
  const folder = status.folders.find((entry) => entry.id === folderId);
  if (!folder) {
    throw new Error('folder_not_found');
  }

  const extensions = extensionsArg(args);
  const scanned = buildLocalFolderResources([folder], { extensions, maxFilesPerFolder: 100 })[0]!;

  return {
    folderId: folder.id,
    label: folder.label,
    path: folder.path,
    files: scanned.files,
    totalFileCount: scanned.totalFileCount,
    truncated: scanned.truncated,
  };
};

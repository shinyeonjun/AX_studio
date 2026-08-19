import { getModuleSourceFilesHandler } from '../../modules/packages/register.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const sourcesFilesList: DesignToolHandler = (ctx, args) => {
  const folderId = stringArg(args, 'folderId');
  if (!folderId) {
    throw new Error('folderId_required');
  }

  const handler = getModuleSourceFilesHandler('local_folder');
  if (!handler) {
    throw new Error('local_folder_source_files_unavailable');
  }

  return handler(ctx, args);
};

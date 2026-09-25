import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { realpathSync } from 'node:fs';
import { findLocalFolder, parseLocalFolderConnectionConfig } from '../../platform/local-folder-config.js';
import { resolveFileWithinFolderRoot } from '../../platform/local-folder-path.js';
import { readSheetFromPath } from './read/sheet.js';

export class LocalSheetConnector implements Connector {
  name = 'local_sheet';

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action !== 'read') {
      return { ok: false, error: `Unknown local_sheet action: ${action}` };
    }

    const path = typeof params.path === 'string' ? params.path.trim() : '';
    if (!path) {
      return { ok: false, error: 'path_required', errorCode: 'path_required' };
    }

    let authorizedPath: string | undefined;
    const folderId = typeof params.folderId === 'string' ? params.folderId.trim() : '';
    if (folderId) {
      const connection = ctx.connections?.find((entry) => entry.connector === 'local_folder' && entry.connected);
      const config = connection?.config ? parseLocalFolderConnectionConfig(connection.config) : null;
      const folder = config ? findLocalFolder(config, folderId) : undefined;
      if (!folder) return { ok: false, error: 'folder_not_found', errorCode: 'folder_not_found' };
      const resolved = resolveFileWithinFolderRoot(folder.path, path);
      if (!resolved.ok) return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
      authorizedPath = resolved.path;
    } else {
      try {
        const realPath = realpathSync(path);
        if (!ctx.allowedFilePaths?.some((allowed) => realpathSync(allowed) === realPath)) {
          return { ok: false, error: 'file_path_not_authorized', errorCode: 'file_path_not_authorized' };
        }
        authorizedPath = realPath;
      } catch {
        return { ok: false, error: 'file_not_accessible', errorCode: 'file_not_accessible' };
      }
    }

    try {
      const sheetName = typeof params.sheet === 'string' ? params.sheet : undefined;
      const table = await readSheetFromPath({ path: authorizedPath!, sheetName });
      ctx.variables.sheet = table;
      return { ok: true, data: table };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'sheet_not_found') {
        return { ok: false, error: 'sheet_not_found', errorCode: 'sheet_not_found' };
      }
      return { ok: false, error: message, errorCode: 'read_failed' };
    }
  }
}

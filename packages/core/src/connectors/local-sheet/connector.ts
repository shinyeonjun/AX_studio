import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { readSheetFromPath } from './read/sheet.js';
import { extname } from 'node:path';
import { parseLocalFolderConnectionConfig } from '../../platform/local-folder-config.js';
import { resolveFileWithinFolderRoot } from '../../platform/local-folder-path.js';

export class LocalSheetConnector implements Connector {
  name = 'local_sheet';

  /** Registered production readers are scoped; explicit low-level readers accept trusted paths. */
  constructor(private readonly sourceScope?: { artifactRoot: () => string }) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action !== 'read') {
      return { ok: false, error: `Unknown local_sheet action: ${action}` };
    }

    let path = typeof params.path === 'string' ? params.path.trim() : '';
    if (!path) {
      return { ok: false, error: 'path_required', errorCode: 'path_required' };
    }

    if (this.sourceScope) {
      const roots = (ctx.connections ?? [])
        .filter(connection => connection.connector === 'local_folder' && connection.connected)
        .flatMap(connection => parseLocalFolderConnectionConfig(connection.config)?.folders.map(folder => folder.path) ?? []);
      roots.push(this.sourceScope.artifactRoot());
      const resolved = roots.map(root => resolveFileWithinFolderRoot(root, path)).find(result => result.ok);
      if (!resolved?.ok || !['.csv', '.xlsx', '.xls'].includes(extname(resolved.path).toLowerCase())) {
        return { ok: false, error: '연결된 폴더 또는 가져온 시트 자료만 읽을 수 있습니다.', errorCode: 'path_outside_source' };
      }
      path = resolved.path;
    }

    try {
      const sheetName = typeof params.sheet === 'string' ? params.sheet : undefined;
      const table = readSheetFromPath({ path, sheetName });
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

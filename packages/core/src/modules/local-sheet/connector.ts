import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { readSheetFromPath } from './read.js';

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

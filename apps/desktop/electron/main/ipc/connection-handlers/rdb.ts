import { ipcMain, dialog } from 'electron';
import { getCore } from '../../core-instance.js';
import { disconnectRdb, validateAndConnectRdb } from '../../rdb/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerRdbConnectionHandlers() {
  ipcMain.handle('ax:pickSqliteFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'SQLite DB 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true as const };
    }
    return { ok: true as const, path: result.filePaths[0] };
  });

  ipcMain.handle('ax:connectRdb', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('DB 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const type = record.type;
    if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite') {
      throw new Error('DB 유형이 올바르지 않습니다.');
    }
    await validateAndConnectRdb(core.store, core.runtime, {
      type,
      connectionString: typeof record.connectionString === 'string' ? record.connectionString : undefined,
      filePath: typeof record.filePath === 'string' ? record.filePath : undefined,
      allowedSchemas: Array.isArray(record.allowedSchemas)
        ? record.allowedSchemas.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
      allowedTables: Array.isArray(record.allowedTables)
        ? record.allowedTables.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
      rowLimit: typeof record.rowLimit === 'number' ? record.rowLimit : undefined,
      label: typeof record.label === 'string' ? record.label : undefined,
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectRdb', async () => {
    const core = getCore();
    await disconnectRdb(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });
}

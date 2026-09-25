import { dialog } from 'electron';
import { realpathSync } from 'node:fs';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { disconnectRdb, validateAndConnectRdb } from '../../rdb/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

let approvedSqliteSelection: { path: string; connecting: boolean } | undefined;

function sqlitePathKey(path: string): string {
  const real = realpathSync(path);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

export function registerRdbConnectionHandlers() {
  ipcHandle('ax:pickSqliteFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'SQLite DB 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true as const };
    }
    const selected = sqlitePathKey(result.filePaths[0]!);
    approvedSqliteSelection = { path: selected, connecting: false };
    return { ok: true as const, path: selected };
  });

  ipcHandle('ax:connectRdb', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('DB 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const type = record.type;
    if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite') {
      throw new Error('DB 유형이 올바르지 않습니다.');
    }
    let sqliteSelection: typeof approvedSqliteSelection = undefined;
    let filePath = typeof record.filePath === 'string' ? record.filePath.trim() || undefined : undefined;
    if (type === 'sqlite') {
      if (!filePath) throw new Error('SQLite 파일을 선택해야 합니다.');
      filePath = sqlitePathKey(filePath);
      sqliteSelection = approvedSqliteSelection;
      if (sqliteSelection?.path !== filePath) {
        throw new Error('SQLite 파일은 먼저 시스템 선택기로 선택해야 합니다.');
      }
      if (sqliteSelection.connecting) {
        throw new Error('SQLite 파일 연결이 이미 진행 중입니다.');
      }
      sqliteSelection.connecting = true;
    }
    try {
      await validateAndConnectRdb(core.store, core.runtime, {
        type,
        connectionString: typeof record.connectionString === 'string' ? record.connectionString : undefined,
        filePath,
        allowedSchemas: Array.isArray(record.allowedSchemas)
          ? record.allowedSchemas.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        allowedTables: Array.isArray(record.allowedTables)
          ? record.allowedTables.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
        rowLimit: typeof record.rowLimit === 'number' ? record.rowLimit : undefined,
        label: typeof record.label === 'string' ? record.label : undefined,
      });
    } catch (error) {
      if (sqliteSelection && approvedSqliteSelection === sqliteSelection) sqliteSelection.connecting = false;
      throw error;
    }
    if (sqliteSelection && approvedSqliteSelection === sqliteSelection) approvedSqliteSelection = undefined;
    notifyStateChanged();
    return { ok: true };
  });

  ipcHandle('ax:disconnectRdb', async () => {
    const core = getCore();
    await disconnectRdb(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });
}

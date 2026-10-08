import { dialog } from 'electron';
import { realpathSync } from 'node:fs';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { rdbDatabaseEntries } from '@ax-studio/core';
import {
  discoverRdbTableNames,
  disconnectRdb,
  fillRdbTableDescriptions,
  validateAndConnectRdb,
  type RdbConnectResult,
} from '../../rdb/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

let approvedSqliteSelection: { path: string; connecting: boolean } | undefined;

function sqlitePathKey(path: string): string {
  const real = realpathSync(path);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/** Whether a connected database already uses this SQLite file, which the person chose once. */
function isConnectedSqlitePath(pathKey: string): boolean {
  const connection = getCore().store.getConnections().find((entry) => entry.connector === 'rdb');
  if (!connection?.connected) return false;
  return rdbDatabaseEntries(connection.config).some((entry) => {
    if (entry.type !== 'sqlite' || !entry.filePath) return false;
    try {
      return sqlitePathKey(entry.filePath) === pathKey;
    } catch {
      return false;
    }
  });
}

/** An optional database id; a malformed one must not silently become "a new one" or "all". */
function optionalDatabaseId(value: unknown, message: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}

const UNKNOWN_DATABASE_MESSAGE = '해당 DB 연결을 찾을 수 없어요. 화면을 새로 고쳐 주세요.';

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

  // Lists tables only for a file the person picked (or the one already connected) or the address
  // they typed; nothing is saved, so the allowlist stays exactly what they then choose.
  ipcHandle('ax:discoverRdbTables', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('DB 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const type = record.type;
    if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite') {
      throw new Error('DB 유형이 올바르지 않습니다.');
    }
    const databaseId = optionalDatabaseId(record.databaseId, UNKNOWN_DATABASE_MESSAGE);
    if (type !== 'sqlite') {
      return discoverRdbTableNames({
        type,
        connectionString: typeof record.connectionString === 'string' ? record.connectionString : undefined,
        databaseId,
      });
    }
    const requested = typeof record.filePath === 'string' ? record.filePath.trim() : '';
    if (!requested) throw new Error('SQLite 파일을 먼저 선택해 주세요.');
    const filePath = sqlitePathKey(requested);
    if (approvedSqliteSelection?.path !== filePath && !isConnectedSqlitePath(filePath)) {
      throw new Error('SQLite 파일은 먼저 시스템 선택기로 선택해야 합니다.');
    }
    return discoverRdbTableNames({ type, filePath });
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
    const databaseId = optionalDatabaseId(record.databaseId, UNKNOWN_DATABASE_MESSAGE);
    let sqliteSelection: typeof approvedSqliteSelection = undefined;
    let filePath = typeof record.filePath === 'string' ? record.filePath.trim() || undefined : undefined;
    if (type === 'sqlite') {
      if (!filePath) throw new Error('SQLite 파일을 선택해야 합니다.');
      filePath = sqlitePathKey(filePath);
      sqliteSelection = approvedSqliteSelection?.path === filePath ? approvedSqliteSelection : undefined;
      // Changing the tables of the file already connected needs no new pick: it was chosen once.
      if (!sqliteSelection && !isConnectedSqlitePath(filePath)) {
        throw new Error('SQLite 파일은 먼저 시스템 선택기로 선택해야 합니다.');
      }
      if (sqliteSelection?.connecting) {
        throw new Error('SQLite 파일 연결이 이미 진행 중입니다.');
      }
      if (sqliteSelection) sqliteSelection.connecting = true;
    }
    let connected: RdbConnectResult | undefined;
    try {
      connected = await validateAndConnectRdb(core.store, core.runtime, {
        databaseId,
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
    // In the background: Korean descriptions of the new tables, so Jev can match requests to them.
    void fillRdbTableDescriptions(core.store, core.agentHarness).then(() => notifyStateChanged()).catch(() => undefined);
    return {
      ok: true,
      ...(connected?.databaseId ? { databaseId: connected.databaseId } : {}),
      ...(connected?.label ? { label: connected.label } : {}),
      ...(connected?.warning ? { warning: connected.warning } : {}),
    };
  });

  ipcHandle('ax:disconnectRdb', async (_event, databaseId?: unknown) => {
    const core = getCore();
    // A malformed id must not silently become "disconnect everything".
    const id = optionalDatabaseId(databaseId, '해제할 DB 연결을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
    await disconnectRdb(core.store, core.runtime, id);
    notifyStateChanged();
    return { ok: true };
  });
}

import { ipcMain, dialog } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  SlackConnector,
  LocalFolderConnector,
  validateSlackBotToken,
  getLocalFolderConnectionStatus,
  parseLocalFolderConnectionConfig,
  removeLocalFolder,
  upsertLocalFolder,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../gmail/connection.js';
import { deleteSlackSecret, getSlackSecret, saveSlackSecret } from '../slack/connection.js';
import { disconnectHttp, validateAndConnectHttp } from '../http/connection.js';
import {
  disconnectWebhook,
  validateAndConnectWebhook,
} from '../webhook/connection.js';
import { disconnectRdb, validateAndConnectRdb } from '../rdb/connection.js';
import { disconnectOpenApi, validateAndConnectOpenApi } from '../openapi/connection.js';
import { disconnectMcp, validateAndConnectMcp } from '../mcp/connection.js';
import { notifyStateChanged } from '../state-broadcast.js';

function readSlackPayload(payload: unknown): { token: string; appToken?: string } {
  if (typeof payload === 'string') {
    return { token: payload.trim() };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Slack 연결 정보 형식이 올바르지 않습니다.');
  }
  const record = payload as Record<string, unknown>;
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  const appToken =
    record.appToken === undefined
      ? undefined
      : typeof record.appToken === 'string'
        ? record.appToken.trim() || undefined
        : (() => {
            throw new Error('Slack App-Level Token 형식이 올바르지 않습니다.');
          })();
  return { token, appToken };
}

export function registerConnectionHandlers() {
  ipcMain.handle(
    'ax:connectSlack',
    async (_e, payload: unknown) => {
      const core = getCore();
      const { token: inputToken, appToken } = readSlackPayload(payload);

      const existingSecret = await getSlackSecret();
      const token = inputToken || existingSecret?.token || '';
      if (!token) {
        throw new Error('Bot Token을 입력해 주세요.');
      }
      if (!token.startsWith('xoxb-')) {
        throw new Error('Bot Token은 xoxb- 로 시작해야 합니다.');
      }
      if (appToken && !appToken.startsWith('xapp-')) {
        throw new Error('App-Level Token은 xapp- 로 시작해야 합니다.');
      }

      const existingConnection = core.store.getConnections().find((entry) => entry.connector === 'slack');
      const existing = existingConnection?.config as
        | { appToken?: string; appTokenStored?: boolean; team?: string; botUser?: string; connectedAt?: string }
        | undefined;
      const finalAppToken = appToken ?? existingSecret?.appToken;

      const validation = await validateSlackBotToken(token);
      if (!validation.ok) {
        core.store.setConnection('slack', false, {
          team: existing?.team,
          botUser: existing?.botUser,
          connectedAt: existing?.connectedAt,
          tokenStored: Boolean(existingSecret),
          appTokenStored: Boolean(existingSecret?.appToken),
          lastError: validation.error,
        });
        throw new Error(validation.error ?? 'Slack 연결에 실패했습니다.');
      }

      await saveSlackSecret({ token, appToken: finalAppToken });
      core.runtime.connectors.slack = new SlackConnector(token);

      const slackConfig = {
        team: validation.team,
        botUser: validation.botUser,
        connectedAt: new Date().toISOString(),
        tokenStored: true,
        appTokenStored: Boolean(finalAppToken),
      };
      core.store.setConnection('slack', true, slackConfig);

      let socketError: string | undefined;
      try {
        await core.triggerEngine.refreshSlackSocket({ token, appToken: finalAppToken });
      } catch (err) {
        socketError = (err as Error).message;
      }

      const socketModeActive = core.triggerEngine.slackSocketActive();
      if (socketError) {
        core.store.setConnection('slack', true, { ...slackConfig, lastError: socketError });
      }

      notifyStateChanged();

      if (socketError && finalAppToken) {
        return {
          ok: true,
          socketModeActive: false,
          warning: `Bot Token은 연결됐지만 Socket Mode 시작에 실패했습니다: ${socketError}`,
        };
      }

      return {
        ok: true,
        socketModeActive,
        hasAppToken: Boolean(finalAppToken),
      };
    },
  );
  ipcMain.handle('ax:disconnectSlack', async () => {
    const core = getCore();
    await core.triggerEngine.refreshSlackSocket(null);
    await deleteSlackSecret();
    core.runtime.setConnector('slack', null);
    core.store.setConnection('slack', false);
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:connectGmailOAuth', async () => {
    const core = getCore();
    return connectGmailOAuth(core.store, core.runtime);
  });
  ipcMain.handle('ax:disconnectGmailOAuth', async () => {
    const core = getCore();
    return disconnectGmailOAuth(core.store, core.runtime);
  });

  ipcMain.handle('ax:pickLocalFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '연결할 폴더 선택',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true as const };
    }
    return { ok: true as const, path: result.filePaths[0] };
  });

  ipcMain.handle('ax:addLocalFolder', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('폴더 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const folderPath = typeof record.path === 'string' ? record.path.trim() : '';
    if (!folderPath) {
      throw new Error('폴더 경로가 필요합니다.');
    }
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
      throw new Error('폴더를 찾을 수 없습니다.');
    }

    const existing = core.store.getConnections().find((entry) => entry.connector === 'local_folder');
    const config = parseLocalFolderConnectionConfig(existing?.config) ?? { folders: [] };
    if (config.folders.some((folder) => folder.path === folderPath)) {
      throw new Error('이미 연결된 폴더입니다.');
    }

    const entry = {
      id: randomUUID(),
      label: typeof record.label === 'string' ? record.label.trim() || basename(folderPath) : basename(folderPath),
      path: folderPath,
      addedAt: new Date().toISOString(),
    };
    const nextConfig = upsertLocalFolder(config, entry);
    core.store.setConnection('local_folder', nextConfig.folders.length > 0, nextConfig as unknown as Record<string, unknown>);
    core.runtime.setConnector('local_folder', new LocalFolderConnector(nextConfig));
    notifyStateChanged();
    return { ok: true, folder: entry, status: getLocalFolderConnectionStatus(nextConfig, true) };
  });

  ipcMain.handle('ax:removeLocalFolder', async (_event, folderId: unknown) => {
    const core = getCore();
    if (typeof folderId !== 'string' || !folderId.trim()) {
      throw new Error('folderId가 필요합니다.');
    }

    const existing = core.store.getConnections().find((entry) => entry.connector === 'local_folder');
    const config = parseLocalFolderConnectionConfig(existing?.config) ?? { folders: [] };
    const nextConfig = removeLocalFolder(config, folderId);
    core.store.setConnection('local_folder', nextConfig.folders.length > 0, nextConfig as unknown as Record<string, unknown>);
    core.runtime.setConnector(
      'local_folder',
      nextConfig.folders.length > 0 ? new LocalFolderConnector(nextConfig) : null,
    );
    notifyStateChanged();
    return { ok: true, status: getLocalFolderConnectionStatus(nextConfig, nextConfig.folders.length > 0) };
  });

  ipcMain.handle('ax:connectHttp', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('HTTP 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const authType = record.authType;
    if (authType !== 'none' && authType !== 'bearer' && authType !== 'apiKey' && authType !== 'basic') {
      throw new Error('인증 유형이 올바르지 않습니다.');
    }
    await validateAndConnectHttp(core.store, core.runtime, {
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      authType,
      authHeader: typeof record.authHeader === 'string' ? record.authHeader : undefined,
      username: typeof record.username === 'string' ? record.username : undefined,
      token: typeof record.token === 'string' ? record.token : undefined,
      password: typeof record.password === 'string' ? record.password : undefined,
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectHttp', async () => {
    const core = getCore();
    await disconnectHttp(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:connectWebhook', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Webhook 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const port = typeof record.port === 'number' ? record.port : Number(record.port);
    await validateAndConnectWebhook(
      core.store,
      core.runtime,
      {
        port,
        secret: typeof record.secret === 'string' ? record.secret : '',
        label: typeof record.label === 'string' ? record.label : undefined,
        tunnelUrl: typeof record.tunnelUrl === 'string' ? record.tunnelUrl : undefined,
      },
      () => core.triggerEngine.refreshPushTransports(),
    );
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectWebhook', async () => {
    const core = getCore();
    await disconnectWebhook(core.store, () => core.triggerEngine.refreshPushTransports());
    notifyStateChanged();
    return { ok: true };
  });

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

  ipcMain.handle('ax:connectOpenApi', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('OpenAPI 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    await validateAndConnectOpenApi(core.store, core.runtime, {
      specId: typeof record.specId === 'string' ? record.specId : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      specUrl: typeof record.specUrl === 'string' ? record.specUrl : undefined,
      specJson: typeof record.specJson === 'string' ? record.specJson : undefined,
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectOpenApi', async () => {
    const core = getCore();
    await disconnectOpenApi(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:connectMcp', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('MCP 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    await validateAndConnectMcp(core.store, core.runtime, {
      serverId: typeof record.serverId === 'string' ? record.serverId : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      toolsJson: typeof record.toolsJson === 'string' ? record.toolsJson : '',
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectMcp', async () => {
    const core = getCore();
    await disconnectMcp(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });
}

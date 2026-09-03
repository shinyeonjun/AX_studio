import { ipcMain, dialog } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LocalFolderConnector,
  getLocalFolderConnectionStatus,
  parseLocalFolderConnectionConfig,
  removeLocalFolder,
  upsertLocalFolder,
} from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerLocalFolderConnectionHandlers() {
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
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  getCore: vi.fn(),
  notifyStateChanged: vi.fn(),
}));

vi.mock('electron', () => ({ dialog: { showOpenDialog: mocks.showOpenDialog } }));
vi.mock('../ipc-handle.js', () => ({
  ipcHandle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
}));
vi.mock('../../core-instance.js', () => ({ getCore: mocks.getCore }));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notifyStateChanged }));
vi.mock('@ax-studio/core', () => ({
  LocalFolderConnector: class { constructor(readonly config: unknown) {} },
  getLocalFolderConnectionStatus: () => ({ connected: true }),
  parseLocalFolderConnectionConfig: (value: unknown) => value as { folders: Array<Record<string, unknown>> } | undefined,
  removeLocalFolder: (config: { folders: Array<Record<string, unknown>> }, id: string) => ({
    folders: config.folders.filter((folder) => folder.id !== id),
  }),
  upsertLocalFolder: (config: { folders: Array<Record<string, unknown>> }, entry: Record<string, unknown>) => ({
    folders: [...config.folders, entry],
  }),
}));

import { registerLocalFolderConnectionHandlers } from './local-folder.js';

describe('local folder path selection authorization', () => {
  let config: { folders: Array<Record<string, unknown>> };

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
    mocks.notifyStateChanged.mockReset();

    config = { folders: [] };
    const core = {
      store: {
        getConnections: vi.fn(() => config.folders.length
          ? [{ connector: 'local_folder', config }]
          : []),
        setConnection: vi.fn((_connector: string, _active: boolean, next: unknown) => {
          config = next as typeof config;
        }),
      },
      runtime: { setConnector: vi.fn() },
    };
    mocks.getCore.mockReset().mockReturnValue(core);
    registerLocalFolderConnectionHandlers();
  });

  it('replaces and consumes the single picker approval', async () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const firstPath = testDirectory;
    const secondPath = resolve(testDirectory, '..');
    config.folders.push({
      id: 'existing-folder',
      label: 'Existing folder',
      path: process.platform === 'win32' ? firstPath.toUpperCase() : firstPath,
      addedAt: '2026-09-25T00:00:00.000Z',
    });
    const pick = mocks.handlers.get('ax:pickLocalFolder')!;
    const add = mocks.handlers.get('ax:addLocalFolder')!;

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [firstPath] });
    const first = await pick({}) as { path: string };
    await expect(add({}, { path: first.path })).rejects.toThrow('이미 연결된 폴더입니다.');

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [secondPath] });
    const second = await pick({}) as { path: string };

    await expect(add({}, { path: first.path })).rejects.toThrow('폴더는 먼저 시스템 선택기로 선택해야 합니다.');
    await expect(add({}, { path: second.path })).resolves.toMatchObject({ ok: true });
    await expect(add({}, { path: second.path })).rejects.toThrow('폴더는 먼저 시스템 선택기로 선택해야 합니다.');

    const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
    expect(first.path).toBe(normalize(realpathSync(firstPath)));
    expect(second.path).toBe(normalize(realpathSync(secondPath)));
    expect(mocks.getCore().store.setConnection).toHaveBeenCalledOnce();
  });
});

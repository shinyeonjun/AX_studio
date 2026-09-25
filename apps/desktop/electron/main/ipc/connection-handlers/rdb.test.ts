import { beforeEach, describe, expect, it, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  getCore: vi.fn(),
  validateAndConnectRdb: vi.fn(),
  disconnectRdb: vi.fn(),
  notifyStateChanged: vi.fn(),
}));

vi.mock('electron', () => ({ dialog: { showOpenDialog: mocks.showOpenDialog } }));
vi.mock('../ipc-handle.js', () => ({
  ipcHandle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
}));
vi.mock('../../core-instance.js', () => ({ getCore: mocks.getCore }));
vi.mock('../../rdb/connection.js', () => ({
  validateAndConnectRdb: mocks.validateAndConnectRdb,
  disconnectRdb: mocks.disconnectRdb,
}));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notifyStateChanged }));

import { registerRdbConnectionHandlers } from './rdb.js';

describe('SQLite path selection authorization', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
    mocks.getCore.mockReset().mockReturnValue({ store: {}, runtime: {} });
    mocks.validateAndConnectRdb.mockReset().mockResolvedValue(undefined);
    mocks.disconnectRdb.mockReset().mockResolvedValue(undefined);
    mocks.notifyStateChanged.mockReset();
    registerRdbConnectionHandlers();
  });

  it('retains only the most recently selected SQLite path', async () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const firstPath = resolve(testDirectory, '../../../../package.json');
    const secondPath = resolve(testDirectory, '../../../../../../packages/core/package.json');
    const pick = mocks.handlers.get('ax:pickSqliteFile')!;
    const connect = mocks.handlers.get('ax:connectRdb')!;
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [firstPath] });
    const first = await pick({}) as { path: string };
    await connect({}, { type: 'sqlite', filePath: first.path });
    await expect(connect({}, { type: 'sqlite', filePath: first.path }))
      .rejects.toThrow('SQLite 파일은 먼저 시스템 선택기로 선택해야 합니다.');

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [secondPath] });
    const second = await pick({}) as { path: string };
    await expect(connect({}, { type: 'sqlite', filePath: first.path }))
      .rejects.toThrow('SQLite 파일은 먼저 시스템 선택기로 선택해야 합니다.');
    await expect(connect({}, { type: 'sqlite', filePath: second.path })).resolves.toEqual({ ok: true });
    await expect(connect({}, { type: 'sqlite', filePath: second.path }))
      .rejects.toThrow('SQLite 파일은 먼저 시스템 선택기로 선택해야 합니다.');

    const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
    expect(first.path).toBe(normalize(realpathSync(firstPath)));
    expect(second.path).toBe(normalize(realpathSync(secondPath)));
    expect(mocks.validateAndConnectRdb).toHaveBeenCalledTimes(2);
  });

  it('prevents concurrent reuse but preserves a newer selection and permits retry after failure', async () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const firstPath = resolve(testDirectory, '../../../../package.json');
    const secondPath = resolve(testDirectory, '../../../../../../packages/core/package.json');
    const pick = mocks.handlers.get('ax:pickSqliteFile')!;
    const connect = mocks.handlers.get('ax:connectRdb')!;

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [firstPath] });
    const first = await pick({}) as { path: string };
    let finishFirst!: () => void;
    mocks.validateAndConnectRdb.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const firstConnect = connect({}, { type: 'sqlite', filePath: first.path });
    await expect(connect({}, { type: 'sqlite', filePath: first.path }))
      .rejects.toThrow('SQLite 파일 연결이 이미 진행 중입니다.');

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [secondPath] });
    const second = await pick({}) as { path: string };
    finishFirst();
    await firstConnect;
    await expect(connect({}, { type: 'sqlite', filePath: second.path })).resolves.toEqual({ ok: true });

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [firstPath] });
    const retry = await pick({}) as { path: string };
    mocks.validateAndConnectRdb.mockRejectedValueOnce(new Error('database is invalid'));
    await expect(connect({}, { type: 'sqlite', filePath: retry.path })).rejects.toThrow('database is invalid');
    await expect(connect({}, { type: 'sqlite', filePath: retry.path })).resolves.toEqual({ ok: true });
  });
});

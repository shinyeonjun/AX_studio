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
  discoverRdbTableNames: vi.fn(),
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
  discoverRdbTableNames: mocks.discoverRdbTableNames,
}));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notifyStateChanged }));

import { registerRdbConnectionHandlers } from './rdb.js';

describe('SQLite path selection authorization', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
    mocks.getCore.mockReset().mockReturnValue({ store: { getConnections: () => [] }, runtime: {} });
    mocks.discoverRdbTableNames.mockReset().mockResolvedValue({ tables: ['orders'], truncated: false });
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

describe('listing the tables of a database being connected', () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const picked = resolve(testDirectory, '../../../../package.json');
  const other = resolve(testDirectory, '../../../../../../packages/core/package.json');

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
    mocks.getCore.mockReset().mockReturnValue({ store: { getConnections: () => [] }, runtime: {} });
    mocks.discoverRdbTableNames.mockReset().mockResolvedValue({ tables: ['orders'], truncated: false });
    registerRdbConnectionHandlers();
  });

  it('reads only a SQLite file the person picked, never a path the page names', async () => {
    const discover = mocks.handlers.get('ax:discoverRdbTables')!;
    await expect(discover({}, { type: 'sqlite', filePath: other })).rejects.toThrow('시스템 선택기로 선택');
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picked] });
    const selection = await mocks.handlers.get('ax:pickSqliteFile')!({}) as { path: string };
    await expect(discover({}, { type: 'sqlite', filePath: selection.path })).resolves.toEqual({ tables: ['orders'], truncated: false });
    await expect(discover({}, { type: 'sqlite', filePath: other })).rejects.toThrow('시스템 선택기로 선택');
    expect(mocks.discoverRdbTableNames).toHaveBeenCalledTimes(1);
  });

  it('reads the already connected SQLite file again, so editing a connection lists its tables', async () => {
    mocks.getCore.mockReturnValue({
      store: { getConnections: () => [{ connector: 'rdb', connected: true, config: { type: 'sqlite', filePath: picked } }] },
      runtime: {},
    });
    await expect(mocks.handlers.get('ax:discoverRdbTables')!({}, { type: 'sqlite', filePath: picked }))
      .resolves.toEqual({ tables: ['orders'], truncated: false });
    // Saving new table choices for that file needs no new pick either; another file still does.
    await expect(mocks.handlers.get('ax:connectRdb')!({}, { type: 'sqlite', filePath: picked, allowedTables: ['orders'] }))
      .resolves.toEqual({ ok: true });
    await expect(mocks.handlers.get('ax:connectRdb')!({}, { type: 'sqlite', filePath: other }))
      .rejects.toThrow('시스템 선택기로 선택');
  });
});

import { app } from 'electron';
import electronUpdater from 'electron-updater';
import { getMainWindow } from '../app-window.js';
import { isE2ERuntimeEnabled } from '../e2e-test-seam/gates.js';
import { ipcHandle } from '../ipc/ipc-handle.js';
import type { UpdateStatus } from './status.js';
import { DesktopUpdates } from './updater.js';

let updates: DesktopUpdates | undefined;

function sendStatus(status: UpdateStatus): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ax:update-status', status);
}

/** Packaged builds only: a development or test run has no release to update to. */
export function startDesktopUpdates(): void {
  if (!app.isPackaged || isE2ERuntimeEnabled(app.isPackaged, process.env) || updates) return;
  updates = new DesktopUpdates(electronUpdater.autoUpdater, {
    currentVersion: app.getVersion(),
    onStatus: sendStatus,
    log: (message, data) => console.warn(`[AX Studio] ${message}`, data ?? {}),
  });
  updates.start();
}

export function stopDesktopUpdates(): void {
  updates?.stop();
}

export function registerUpdateHandlers(): void {
  ipcHandle('ax:getUpdateStatus', async (): Promise<UpdateStatus> =>
    updates?.current() ?? { state: 'idle', currentVersion: app.getVersion() });
  ipcHandle('ax:installUpdate', async (): Promise<boolean> => updates?.installNow() ?? false);
}

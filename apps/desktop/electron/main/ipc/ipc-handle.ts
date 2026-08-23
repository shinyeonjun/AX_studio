import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from '../app-window.js';

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('main_window_unavailable');
  }
  if (event.sender.id !== mainWindow.webContents.id) {
    throw new Error('untrusted_ipc_sender');
  }
}

export function ipcHandle<Return, Args extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Return | Promise<Return>,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, ...args: Args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

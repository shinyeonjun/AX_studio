import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getMainWindow, isTrustedRendererUrl } from '../app-window.js';
import { isDesktopShuttingDown } from '../startup/shutdown-state.js';

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('main_window_unavailable');
  }
  if (event.sender.id !== mainWindow.webContents.id) {
    throw new Error('untrusted_ipc_sender');
  }
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererUrl(frame.url)) {
    throw new Error('untrusted_ipc_frame');
  }
}

export function ipcHandle<Return, Args extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Return | Promise<Return>,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, ...args: Args) => {
    assertTrustedSender(event);
    // While quitting the core is draining and then closed; a late renderer request (a state
    // refresh as the window goes away) must not reach a closed database.
    if (isDesktopShuttingDown()) throw new Error('app_shutting_down');
    return handler(event, ...args);
  });
}

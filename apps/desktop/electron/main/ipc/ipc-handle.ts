import { ipcMain, type IpcMainInvokeEvent } from 'electron';

export function ipcHandle<Return, Args extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Return | Promise<Return>,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

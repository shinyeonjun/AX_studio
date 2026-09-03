import { ipcMain } from 'electron';
import { getCore } from '../../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../../gmail/connection.js';

export function registerGmailConnectionHandlers() {
  ipcMain.handle('ax:connectGmailOAuth', async () => {
    const core = getCore();
    return connectGmailOAuth(core.store, core.runtime);
  });
  ipcMain.handle('ax:disconnectGmailOAuth', async () => {
    const core = getCore();
    return disconnectGmailOAuth(core.store, core.runtime);
  });
}

import { ipcMain } from 'electron';
import { SlackConnector } from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../gmail/connection.js';

export function registerConnectionHandlers() {
  ipcMain.handle('ax:connectSlack', async (_e, token: string) => {
    const core = getCore();
    core.store.setConnection('slack', true, { token });
    core.runtime.connectors.slack = new SlackConnector(token);
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
}

import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../../gmail/connection.js';

export function registerGmailConnectionHandlers() {
  ipcHandle('ax:connectGmailOAuth', async () => {
    const core = getCore();
    return connectGmailOAuth(core.store, core.runtime);
  });
  ipcHandle('ax:disconnectGmailOAuth', async () => {
    const core = getCore();
    return disconnectGmailOAuth(core.store, core.runtime);
  });
}

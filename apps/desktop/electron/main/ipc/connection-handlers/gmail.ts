import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../../gmail/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerGmailConnectionHandlers() {
  ipcHandle('ax:connectGmailOAuth', async () => {
    const core = getCore();
    try {
      return await connectGmailOAuth(core.store, core.runtime);
    } finally {
      // Like every connection: other screens (chat, Activity) learn Gmail changed.
      notifyStateChanged();
    }
  });
  ipcHandle('ax:disconnectGmailOAuth', async () => {
    const core = getCore();
    const result = await disconnectGmailOAuth(core.store, core.runtime);
    notifyStateChanged();
    return result;
  });
}

import { ipcMain } from 'electron';
import { getCore } from '../../core-instance.js';
import {
  disconnectWebhook,
  validateAndConnectWebhook,
} from '../../webhook/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerWebhookConnectionHandlers() {
  ipcMain.handle('ax:connectWebhook', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Webhook 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const port = typeof record.port === 'number' ? record.port : Number(record.port);
    try {
      await validateAndConnectWebhook(
        core.store,
        core.runtime,
        {
          port,
          secret: typeof record.secret === 'string' ? record.secret : '',
          label: typeof record.label === 'string' ? record.label : undefined,
          tunnelUrl: typeof record.tunnelUrl === 'string' ? record.tunnelUrl : undefined,
        },
        async () => {
          await core.triggerEngine.refreshPushTransports();
          const status = core.triggerEngine.pushTransportStatus('webhook.inbound');
          if (status?.phase !== 'connected' || !core.triggerEngine.pushTransportActive('webhook.inbound')) {
            throw new Error(status?.error ?? 'Webhook 리스너를 시작하지 못했습니다.');
          }
        },
      );
    } catch (error) {
      notifyStateChanged();
      throw error;
    }
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectWebhook', async () => {
    const core = getCore();
    await disconnectWebhook(core.store, () => core.triggerEngine.refreshPushTransports());
    notifyStateChanged();
    return { ok: true };
  });
}

import { ipcMain } from 'electron';
import { getCore } from '../../core-instance.js';
import { disconnectOpenApi, validateAndConnectOpenApi } from '../../openapi/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerOpenApiConnectionHandlers() {
  ipcMain.handle('ax:connectOpenApi', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('OpenAPI 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    await validateAndConnectOpenApi(core.store, core.runtime, {
      specId: typeof record.specId === 'string' ? record.specId : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      specUrl: typeof record.specUrl === 'string' ? record.specUrl : undefined,
      specJson: typeof record.specJson === 'string' ? record.specJson : undefined,
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectOpenApi', async () => {
    const core = getCore();
    await disconnectOpenApi(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });
}

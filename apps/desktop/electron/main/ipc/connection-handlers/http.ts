import { ipcMain } from 'electron';
import { getCore } from '../../core-instance.js';
import { disconnectHttp, validateAndConnectHttp } from '../../http/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerHttpConnectionHandlers() {
  ipcMain.handle('ax:connectHttp', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('HTTP 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    const authType = record.authType;
    if (authType !== 'none' && authType !== 'bearer' && authType !== 'apiKey' && authType !== 'basic') {
      throw new Error('인증 유형이 올바르지 않습니다.');
    }
    await validateAndConnectHttp(core.store, core.runtime, {
      endpointId: typeof record.endpointId === 'string' ? record.endpointId : undefined,
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      authType,
      authHeader: typeof record.authHeader === 'string' ? record.authHeader : undefined,
      username: typeof record.username === 'string' ? record.username : undefined,
      token: typeof record.token === 'string' ? record.token : undefined,
      password: typeof record.password === 'string' ? record.password : undefined,
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcMain.handle('ax:disconnectHttp', async (_event, endpointId?: unknown) => {
    const core = getCore();
    // A malformed id must not silently become "disconnect everything".
    if (endpointId != null && (typeof endpointId !== 'string' || !endpointId.trim())) {
      throw new Error('해제할 HTTP 연결 ID가 올바르지 않습니다.');
    }
    await disconnectHttp(
      core.store,
      core.runtime,
      typeof endpointId === 'string' ? endpointId.trim() : undefined,
    );
    notifyStateChanged();
    return { ok: true };
  });
}

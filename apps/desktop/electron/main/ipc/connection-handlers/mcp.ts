import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { disconnectMcp, validateAndConnectMcp } from '../../mcp/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerMcpConnectionHandlers() {
  ipcHandle('ax:connectMcp', async (_event, payload: unknown) => {
    const core = getCore();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('MCP 연결 정보 형식이 올바르지 않습니다.');
    }
    const record = payload as Record<string, unknown>;
    await validateAndConnectMcp(core.store, core.runtime, {
      serverId: typeof record.serverId === 'string' ? record.serverId : '',
      label: typeof record.label === 'string' ? record.label : undefined,
      toolsJson: typeof record.toolsJson === 'string' ? record.toolsJson : '',
    });
    notifyStateChanged();
    return { ok: true };
  });

  ipcHandle('ax:disconnectMcp', async () => {
    const core = getCore();
    await disconnectMcp(core.store, core.runtime);
    notifyStateChanged();
    return { ok: true };
  });
}

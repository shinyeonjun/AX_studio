import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { connectSlack, disconnectSlack } from '../../slack/connection.js';
import { notifyStateChanged } from '../../state-broadcast.js';

function readSlackPayload(payload: unknown): { token: string; appToken?: string } {
  if (typeof payload === 'string') {
    return { token: payload.trim() };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Slack 연결 정보 형식이 올바르지 않습니다.');
  }
  const record = payload as Record<string, unknown>;
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  const appToken =
    record.appToken === undefined
      ? undefined
      : typeof record.appToken === 'string'
        ? record.appToken.trim() || undefined
        : (() => {
            throw new Error('Slack App-Level Token 형식이 올바르지 않습니다.');
          })();
  return { token, appToken };
}

export function registerSlackConnectionHandlers() {
  ipcHandle('ax:connectSlack', async (_e, payload: unknown) => {
    const input = readSlackPayload(payload);
    try {
      return await connectSlack(getCore(), input);
    } finally {
      // A rejected token is recorded on the connection too; settings shows why.
      notifyStateChanged();
    }
  });
  ipcHandle('ax:disconnectSlack', async () => {
    await disconnectSlack(getCore());
    notifyStateChanged();
    return { ok: true };
  });
}

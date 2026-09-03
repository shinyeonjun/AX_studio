import { ipcMain } from 'electron';
import {
  SlackConnector,
  validateSlackBotToken,
} from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import {
  deleteSlackSecret,
  getSlackSecretForConnect,
  saveSlackSecret,
} from '../../slack/connection.js';
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
  ipcMain.handle(
    'ax:connectSlack',
    async (_e, payload: unknown) => {
      const core = getCore();
      const { token: inputToken, appToken } = readSlackPayload(payload);

      const existingSecret = await getSlackSecretForConnect(inputToken);
      const token = inputToken || existingSecret?.token || '';
      if (!token) {
        throw new Error('Bot Token을 입력해 주세요.');
      }
      if (!token.startsWith('xoxb-')) {
        throw new Error('Bot Token은 xoxb- 로 시작해야 합니다.');
      }
      if (appToken && !appToken.startsWith('xapp-')) {
        throw new Error('App-Level Token은 xapp- 로 시작해야 합니다.');
      }

      const existingConnection = core.store.getConnections().find((entry) => entry.connector === 'slack');
      const existing = existingConnection?.config as
        | { appToken?: string; appTokenStored?: boolean; team?: string; botUser?: string; connectedAt?: string }
        | undefined;
      const finalAppToken = appToken ?? existingSecret?.appToken;

      const validation = await validateSlackBotToken(token);
      if (!validation.ok) {
        core.store.setConnection('slack', false, {
          team: existing?.team,
          botUser: existing?.botUser,
          connectedAt: existing?.connectedAt,
          tokenStored: Boolean(existingSecret),
          appTokenStored: Boolean(existingSecret?.appToken),
          lastError: validation.error,
        });
        throw new Error(validation.error ?? 'Slack 연결에 실패했습니다.');
      }

      await saveSlackSecret({ token, appToken: finalAppToken });
      core.runtime.connectors.slack = new SlackConnector(token);

      const slackConfig = {
        team: validation.team,
        botUser: validation.botUser,
        connectedAt: new Date().toISOString(),
        tokenStored: true,
        appTokenStored: Boolean(finalAppToken),
      };
      core.store.setConnection('slack', true, slackConfig);

      let socketError: string | undefined;
      try {
        await core.triggerEngine.refreshSlackSocket({ token, appToken: finalAppToken });
      } catch (err) {
        socketError = (err as Error).message;
      }

      const socketModeActive = core.triggerEngine.slackSocketActive();
      if (socketError) {
        core.store.setConnection('slack', true, { ...slackConfig, lastError: socketError });
      }

      notifyStateChanged();

      if (socketError && finalAppToken) {
        return {
          ok: true,
          socketModeActive: false,
          warning: 'Bot Token은 연결됐지만 Socket Mode 시작에 실패했습니다: ' + socketError,
        };
      }

      return {
        ok: true,
        socketModeActive,
        hasAppToken: Boolean(finalAppToken),
      };
    },
  );
  ipcMain.handle('ax:disconnectSlack', async () => {
    const core = getCore();
    await core.triggerEngine.refreshSlackSocket(null);
    await deleteSlackSecret();
    core.runtime.setConnector('slack', null);
    core.store.setConnection('slack', false);
    notifyStateChanged();
    return { ok: true };
  });
}

import { ipcMain } from 'electron';
import { SlackConnector, validateSlackBotToken } from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../gmail/connection.js';

function readSlackPayload(payload: string | { token: string; appToken?: string }) {
  const token = (typeof payload === 'string' ? payload : payload.token).trim();
  const appToken =
    typeof payload === 'string' ? undefined : payload.appToken?.trim() || undefined;
  return { token, appToken };
}

export function registerConnectionHandlers() {
  ipcMain.handle(
    'ax:connectSlack',
    async (_e, payload: string | { token: string; appToken?: string }) => {
      const core = getCore();
      const { token, appToken } = readSlackPayload(payload);

      if (!token) {
        throw new Error('Bot Token을 입력해 주세요.');
      }
      if (!token.startsWith('xoxb-')) {
        throw new Error('Bot Token은 xoxb- 로 시작해야 합니다.');
      }
      if (appToken && !appToken.startsWith('xapp-')) {
        throw new Error('App-Level Token은 xapp- 로 시작해야 합니다.');
      }

      const existing = core.store.getConnections().find((entry) => entry.connector === 'slack')?.config as
        | { appToken?: string }
        | undefined;
      const finalAppToken = appToken ?? existing?.appToken;

      const validation = await validateSlackBotToken(token);
      if (!validation.ok) {
        core.store.setConnection('slack', false, {
          token,
          appToken: finalAppToken,
          lastError: validation.error,
        });
        throw new Error(validation.error ?? 'Slack 연결에 실패했습니다.');
      }

      core.runtime.connectors.slack = new SlackConnector(token);

      let socketError: string | undefined;
      try {
        await core.triggerEngine.refreshSlackSocket({
          token,
          appToken: finalAppToken,
        });
      } catch (err) {
        socketError = (err as Error).message;
      }

      const socketModeActive = core.triggerEngine.slackSocketActive();
      core.store.setConnection('slack', true, {
        token,
        appToken: finalAppToken,
        team: validation.team,
        botUser: validation.botUser,
        connectedAt: new Date().toISOString(),
        lastError: socketError,
      });

      if (socketError && finalAppToken) {
        return {
          ok: true,
          socketModeActive: false,
          warning: `Bot Token은 연결됐지만 Socket Mode 시작에 실패했습니다: ${socketError}`,
        };
      }

      return {
        ok: true,
        socketModeActive,
        hasAppToken: Boolean(finalAppToken),
      };
    },
  );
  ipcMain.handle('ax:connectGmailOAuth', async () => {
    const core = getCore();
    return connectGmailOAuth(core.store, core.runtime);
  });
  ipcMain.handle('ax:disconnectGmailOAuth', async () => {
    const core = getCore();
    return disconnectGmailOAuth(core.store, core.runtime);
  });
}

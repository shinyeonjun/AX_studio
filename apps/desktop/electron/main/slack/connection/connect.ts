import {
  SlackConnector,
  validateSlackBotToken,
  type AxStudioCore,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { deleteSlackSecret, getSlackSecretForConnect, saveSlackSecret } from './secrets.js';

export interface SlackConnectionHost {
  store: WorkflowStore;
  runtime: WorkflowRuntime;
  triggerEngine: Pick<AxStudioCore['triggerEngine'], 'refreshSlackSocket' | 'slackSocketActive'>;
}

export type SlackConnectResult =
  | { ok: true; socketModeActive: false; warning: string }
  | { ok: true; socketModeActive: boolean; hasAppToken: boolean };

/**
 * Checks the bot token with Slack, keeps both tokens in the secure store, points the connector at
 * the new token and (re)starts Socket Mode. A blank token reuses the stored one. A rejected
 * replacement never tears down a working connection; it only records why it was rejected.
 */
export async function connectSlack(
  host: SlackConnectionHost,
  input: { token: string; appToken?: string },
): Promise<SlackConnectResult> {
  const { store, runtime, triggerEngine } = host;
  const existingSecret = await getSlackSecretForConnect(input.token);
  const token = input.token || existingSecret?.token || '';
  if (!token) throw new Error('Bot Token을 입력해 주세요.');
  if (!token.startsWith('xoxb-')) throw new Error('Bot Token은 xoxb- 로 시작해야 합니다.');
  if (input.appToken && !input.appToken.startsWith('xapp-')) throw new Error('App-Level Token은 xapp- 로 시작해야 합니다.');

  const existingConnection = store.getConnections().find((entry) => entry.connector === 'slack');
  const existing = existingConnection?.config as
    | { team?: string; botUser?: string; connectedAt?: string }
    | undefined;
  const appToken = input.appToken ?? existingSecret?.appToken;

  const validation = await validateSlackBotToken(token);
  if (!validation.ok) {
    if (existingConnection?.connected) {
      store.setConnection('slack', true, { ...(existingConnection.config ?? {}), lastError: validation.error });
    } else {
      store.setConnection('slack', false, {
        team: existing?.team,
        botUser: existing?.botUser,
        connectedAt: existing?.connectedAt,
        tokenStored: Boolean(existingSecret),
        appTokenStored: Boolean(existingSecret?.appToken),
        lastError: validation.error,
      });
    }
    throw new Error(validation.error ?? 'Slack 연결에 실패했습니다.');
  }

  await saveSlackSecret({ token, appToken });
  runtime.setConnector('slack', new SlackConnector(token));
  const slackConfig = {
    team: validation.team,
    botUser: validation.botUser,
    connectedAt: new Date().toISOString(),
    tokenStored: true,
    appTokenStored: Boolean(appToken),
  };
  store.setConnection('slack', true, slackConfig);

  let socketError: string | undefined;
  try {
    await triggerEngine.refreshSlackSocket({ token, appToken });
  } catch (error) {
    socketError = (error as Error).message;
  }
  if (socketError) store.setConnection('slack', true, { ...slackConfig, lastError: socketError });
  if (socketError && appToken) {
    return { ok: true, socketModeActive: false, warning: 'Bot Token은 연결됐지만 Socket Mode 시작에 실패했습니다: ' + socketError };
  }
  return { ok: true, socketModeActive: triggerEngine.slackSocketActive(), hasAppToken: Boolean(appToken) };
}

export async function disconnectSlack(host: SlackConnectionHost): Promise<void> {
  await host.triggerEngine.refreshSlackSocket(null);
  await deleteSlackSecret();
  host.runtime.setConnector('slack', null);
  host.store.setConnection('slack', false);
}

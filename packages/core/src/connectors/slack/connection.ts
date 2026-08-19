import { WebClient } from '@slack/web-api';
import { parseSlackConnectionConfig } from '../../triggers/types.js';

export interface SlackConnectionRecord {
  token?: string;
  appToken?: string;
  team?: string;
  botUser?: string;
  connectedAt?: string;
  lastError?: string;
}

export interface SlackConnectionValidation {
  ok: boolean;
  team?: string;
  botUser?: string;
  error?: string;
}

export interface SlackConnectionStatus {
  connected: boolean;
  team?: string;
  botUser?: string;
  hasAppToken: boolean;
  socketModeActive: boolean;
  mode: 'disconnected' | 'poll' | 'socket';
  lastError?: string;
}

export async function validateSlackBotToken(token: string): Promise<SlackConnectionValidation> {
  try {
    const client = new WebClient(token);
    const result = await client.auth.test();
    if (!result.ok) {
      return { ok: false, error: 'Slack Bot Token 인증에 실패했습니다.' };
    }
    return {
      ok: true,
      team: result.team ?? undefined,
      botUser: result.user ?? undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || 'Slack Bot Token 인증에 실패했습니다.',
    };
  }
}

export function getSlackConnectionStatus(
  config: unknown,
  connected: boolean,
  socketModeActive: boolean,
): SlackConnectionStatus {
  const parsed = parseSlackConnectionConfig(config);
  const record = (config && typeof config === 'object' ? config : {}) as SlackConnectionRecord;

  if (!connected || !parsed?.token) {
    return {
      connected: false,
      hasAppToken: false,
      socketModeActive: false,
      mode: 'disconnected',
      lastError: record.lastError,
    };
  }

  const hasAppToken = Boolean(parsed.appToken);
  const mode = socketModeActive && hasAppToken ? 'socket' : 'poll';

  return {
    connected: true,
    team: record.team,
    botUser: record.botUser,
    hasAppToken,
    socketModeActive: socketModeActive && hasAppToken,
    mode,
    lastError: record.lastError,
  };
}

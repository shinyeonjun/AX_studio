import type { Connector } from '../connectors/types.js';
import type { Trigger } from '../skill/schema.js';

export interface TriggerEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** Per-skill polling state so the same event is not fired repeatedly. */
export interface TriggerCursor {
  initialized?: boolean;
  seenMessageIds?: string[];
  historyId?: string;
  lastMessageTs?: string;
  channelId?: string;
}

export type TriggerTransport = 'poll' | 'push';

export interface TriggerPollContext {
  skillId: string;
  trigger: Trigger;
  cursor: TriggerCursor;
  connectors: Record<string, Connector>;
}

export interface TriggerPollResult {
  events: TriggerEvent[];
  cursor: TriggerCursor;
}

export interface TriggerHandler<T extends Trigger = Trigger> {
  readonly type: T['type'];
  readonly connector: string;
  readonly transport: TriggerTransport;
  poll?(ctx: TriggerPollContext & { trigger: T }): Promise<TriggerPollResult>;
}

export type TriggerCursorStore = Record<string, TriggerCursor>;

export const TRIGGER_CURSOR_SETTING_KEY = 'trigger.cursors';

export interface SlackConnectionConfig {
  token: string;
  appToken?: string;
}

export function parseSlackConnectionConfig(config: unknown): SlackConnectionConfig | null {
  if (!config || typeof config !== 'object') return null;
  const token = (config as SlackConnectionConfig).token;
  if (typeof token !== 'string' || !token.trim()) return null;
  const appToken = (config as SlackConnectionConfig).appToken;
  return {
    token: token.trim(),
    appToken: typeof appToken === 'string' && appToken.trim() ? appToken.trim() : undefined,
  };
}

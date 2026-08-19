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
}

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
  poll(ctx: TriggerPollContext & { trigger: T }): Promise<TriggerPollResult>;
}

export type TriggerCursorStore = Record<string, TriggerCursor>;

export const TRIGGER_CURSOR_SETTING_KEY = 'trigger.cursors';

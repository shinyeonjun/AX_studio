import { gmailNewMessageHandler } from './gmail-new-message/index.js';
import { slackNewMessageHandler } from './slack-new-message/index.js';
import type { TriggerHandler } from './types.js';

const handlers = new Map<string, TriggerHandler>();

export function registerTriggerHandler(handler: TriggerHandler): void {
  handlers.set(handler.type, handler);
}

export function getTriggerHandler(type: string): TriggerHandler | undefined {
  return handlers.get(type);
}

export function listTriggerHandlers(): TriggerHandler[] {
  return [...handlers.values()];
}

export function registerDefaultTriggerHandlers(): void {
  registerTriggerHandler(gmailNewMessageHandler);
  registerTriggerHandler(slackNewMessageHandler);
}

registerDefaultTriggerHandlers();

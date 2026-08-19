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

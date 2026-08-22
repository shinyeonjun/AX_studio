import type { TriggerHandler } from '../types.js';

export const webhookInboundHandler: TriggerHandler<{ type: 'webhook.inbound'; path: string }> = {
  type: 'webhook.inbound',
  connector: 'webhook',
  transport: 'push',
};

export function webhookPathsMatch(triggerPath: string, eventPath: string): boolean {
  try {
    return normalizePath(triggerPath) === normalizePath(eventPath);
  } catch {
    return false;
  }
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

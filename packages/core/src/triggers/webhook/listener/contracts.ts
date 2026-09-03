import type { TriggerEvent } from '../../types.js';

export interface WebhookListenerOptions {
  port: number;
  secret: string;
  host?: string;
}

export type WebhookEventHandler = (event: TriggerEvent) => void;

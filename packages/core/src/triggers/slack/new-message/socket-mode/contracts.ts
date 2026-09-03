import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import type { TriggerEvent } from '../../../types.js';

export type SlackSocketEventHandler = (event: TriggerEvent) => void;

export interface SlackSocketModeListenerOptions {
  createClient?: (options: SocketModeOptions) => SocketModeClient;
}

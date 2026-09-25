import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import type { TriggerEvent } from '../../../types.js';

export type SlackSocketEventHandler = (event: () => Promise<TriggerEvent>) => void | boolean | Promise<void | boolean>;

export interface SlackSocketModeListenerOptions {
  createClient?: (options: SocketModeOptions) => SocketModeClient;
}

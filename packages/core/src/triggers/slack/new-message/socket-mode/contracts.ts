import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import type { TriggerEvent } from '../../../types.js';

export type SlackSocketEventHandler = (event: () => Promise<TriggerEvent>) => void | boolean | Promise<void | boolean>;

export interface SlackSocketModeListenerOptions {
  createClient?: (options: SocketModeOptions) => SocketModeClient;
  /** First watchdog delay after a stalled reconnect; doubles per restart. Tests shorten it. */
  recoveryWatchdogMs?: number;
}

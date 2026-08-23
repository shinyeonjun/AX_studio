import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { TriggerEvent } from '../../types.js';
import type { PushTransportState, PushTransportStateHandler } from '../../push-state.js';

export type SlackSocketEventHandler = (event: TriggerEvent) => void;

// The SDK default is 5 seconds. A desktop app can be briefly deprioritized by the OS
// or delayed by a proxy without the Slack connection actually being dead.
const SLACK_CLIENT_PING_TIMEOUT_MS = 15_000;

function nestedError(error: Error): unknown {
  const record = error as Error & { cause?: unknown; original?: unknown };
  return record.original ?? record.cause;
}

/** Preserve the SDK's underlying network error instead of exposing only SMWebsocketError. */
export function formatSlackSocketError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const details = [error.message, nestedError(error)]
    .flatMap((value) => {
      if (value instanceof Error) return [value.message || value.name];
      if (typeof value === 'string') return [value];
      return [];
    })
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(details)].join(' | ') || error.name;
}

function isUserMessage(event: Record<string, unknown>): boolean {
  if (event.type !== 'message') return false;
  if (event.subtype) return false;
  if (event.bot_id) return false;
  return Boolean(event.ts && event.channel);
}

export class SlackSocketModeListener {
  private client?: SocketModeClient;
  private web?: WebClient;
  private channelLabels = new Map<string, string>();
  private onEvent?: SlackSocketEventHandler;
  private onStateChange?: PushTransportStateHandler;
  private lastSocketError?: string;

  async start(
    botToken: string,
    appToken: string,
    onEvent: SlackSocketEventHandler,
    onStateChange?: PushTransportStateHandler,
  ): Promise<void> {
    await this.stop();

    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
    this.lastSocketError = undefined;
    this.client = new SocketModeClient({
      appToken,
      clientPingTimeout: SLACK_CLIENT_PING_TIMEOUT_MS,
    });
    this.web = new WebClient(botToken);

    const notify = (state: PushTransportState) => {
      if (state.error) this.lastSocketError = state.error;
      if (state.phase === 'connected') this.lastSocketError = undefined;
      this.onStateChange?.({
        ...state,
        ...(state.error || state.phase === 'reconnecting' || state.phase === 'disconnected'
          ? { error: state.error ?? this.lastSocketError }
          : {}),
      });
    };
    this.client.on('connecting', () => notify({ phase: 'connecting' }));
    this.client.on('connected', () => notify({ phase: 'connected' }));
    this.client.on('reconnecting', () => notify({ phase: 'reconnecting' }));
    this.client.on('close', () => notify({ phase: 'reconnecting' }));
    this.client.on('disconnected', () => notify({ phase: 'disconnected' }));
    this.client.on('error', (error) => {
      const detail = formatSlackSocketError(error);
      console.error(`[slack-socket] WebSocket error: ${detail}`);
      notify({ phase: 'error', error: detail });
    });

    this.client.on('events_api', async ({ event, ack }) => {
      await ack();
      if (!isUserMessage(event as Record<string, unknown>)) return;

      const message = event as {
        type: 'message';
        channel: string;
        ts: string;
        text?: string;
        user?: string;
      };

      const channelId = message.channel;
      const channel = await this.resolveChannelLabel(channelId);

      this.onEvent?.({
        type: 'slack.new_message',
        payload: {
          messageId: message.ts,
          ts: message.ts,
          channel,
          channelId,
          text: message.text ?? '',
          user: message.user,
          sender: message.user,
        },
      });
    });

    try {
      await this.client.start();
    } catch (error) {
      notify({ phase: 'error', error: formatSlackSocketError(error) });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
    this.client = undefined;
    this.web = undefined;
    this.onEvent = undefined;
    this.onStateChange = undefined;
    this.lastSocketError = undefined;
    this.channelLabels.clear();
  }

  isRunning(): boolean {
    return this.client?.websocket?.isActive() ?? false;
  }

  private async resolveChannelLabel(channelId: string): Promise<string> {
    const cached = this.channelLabels.get(channelId);
    if (cached) return cached;

    try {
      const response = await this.web?.conversations.info({ channel: channelId });
      const name = response?.channel?.name;
      const label = name ? `#${name}` : channelId;
      this.channelLabels.set(channelId, label);
      return label;
    } catch {
      return channelId;
    }
  }
}

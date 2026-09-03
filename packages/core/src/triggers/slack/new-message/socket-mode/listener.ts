import { SocketModeClient, type SocketModeOptions } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { PushTransportState, PushTransportStateHandler } from '../../../push-state.js';
import type {
  SlackSocketEventHandler,
  SlackSocketModeListenerOptions,
} from './contracts.js';
import { createSlackSdkLogger, formatSlackSocketError } from './diagnostics.js';

const SLACK_CLIENT_PING_TIMEOUT_MS = 15_000;

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
  private lastLoggedSocketError?: string;
  private lifecycleGeneration = 0;

  constructor(
    private readonly options: SlackSocketModeListenerOptions = {},
  ) {}

  async start(
    botToken: string,
    appToken: string,
    onEvent: SlackSocketEventHandler,
    onStateChange?: PushTransportStateHandler,
  ): Promise<void> {
    await this.stop();
    const generation = ++this.lifecycleGeneration;

    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
    this.lastSocketError = undefined;
    this.lastLoggedSocketError = undefined;
    const sdkLogger = createSlackSdkLogger();
    const client = (
      this.options.createClient ??
      ((clientOptions: SocketModeOptions) => new SocketModeClient(clientOptions))
    )({
      appToken,
      clientPingTimeout: SLACK_CLIENT_PING_TIMEOUT_MS,
      logger: sdkLogger,
    });
    this.client = client;
    this.web = new WebClient(botToken);

    const notify = (state: PushTransportState) => {
      if (generation !== this.lifecycleGeneration) return;
      if (state.error) this.lastSocketError = state.error;
      if (state.phase === 'connected') {
        this.lastSocketError = undefined;
        this.lastLoggedSocketError = undefined;
        sdkLogger.resetError();
      }
      this.onStateChange?.({
        ...state,
        ...(state.error || state.phase === 'reconnecting' || state.phase === 'disconnected'
          ? { error: state.error ?? this.lastSocketError }
          : {}),
      });
    };
    const reportError = (error: unknown) => {
      const detail = formatSlackSocketError(error);
      if (this.lastLoggedSocketError !== detail) {
        console.error(`[slack-socket] WebSocket error: ${detail}`);
        this.lastLoggedSocketError = detail;
      }
      notify({ phase: 'error', error: detail });
    };
    this.client.on('connecting', () => notify({ phase: 'connecting' }));
    this.client.on('connected', () => notify({ phase: 'connected' }));
    this.client.on('reconnecting', () => notify({ phase: 'reconnecting' }));
    this.client.on('close', () => notify({ phase: 'reconnecting' }));
    this.client.on('disconnected', () => notify({ phase: 'disconnected' }));
    this.client.on('error', reportError);

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

    let startPromise: Promise<unknown>;
    try {
      startPromise = client.start();
    } catch (error) {
      reportError(error);
      return;
    }
    // SocketModeClient deliberately keeps its start promise pending while its
    // built-in reconnect loop is active. Do not make the desktop connection
    // handler wait forever for a transient or terminal first-connection error.
    void startPromise.catch((error) => {
      if (generation === this.lifecycleGeneration) reportError(error);
    });
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    const client = this.client;
    if (client) {
      await client.disconnect();
    }
    if (this.client === client) this.client = undefined;
    this.web = undefined;
    this.onEvent = undefined;
    this.onStateChange = undefined;
    this.lastSocketError = undefined;
    this.lastLoggedSocketError = undefined;
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

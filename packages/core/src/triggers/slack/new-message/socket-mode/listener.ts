import { isMessageWithText } from '../../../../connectors/slack/person-message.js';
import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import type { WebClient } from '@slack/web-api';
import type { PushTransportState, PushTransportStateHandler } from '../../../push-state.js';
import type {
  SlackSocketEventHandler,
  SlackSocketModeListenerOptions,
} from './contracts.js';
import { createSlackSdkLogger, formatSlackSocketError } from './diagnostics.js';

const SLACK_CLIENT_PING_TIMEOUT_MS = 15_000;
const SLACK_CHANNEL_LABEL_CACHE_MAX = 256;
const SLACK_CHANNEL_LABEL_CACHE_TTL_MS = 10 * 60 * 1_000;
const SLACK_DISCONNECT_TIMEOUT_MS = 2_000;
/**
 * The SDK emits `reconnecting` when its retry timer fires and `connecting` once the new WSS URL is
 * issued. If the URL request is rejected as unrecoverable, the SDK drops its retry chain without any
 * event, so `connecting` never follows. This watchdog then opens a fresh client.
 */
const SLACK_RECOVERY_WATCHDOG_MS = 30_000;
const SLACK_RECOVERY_WATCHDOG_MAX_MS = 5 * 60 * 1_000;

/**
 * SocketModeClient.disconnect() waits for the close handshake and can stay pending when
 * Slack never completes it, which blocked app shutdown. The listener has already dropped
 * its handlers, so give up waiting after a short bound.
 */
async function disconnectWithin(client: Pick<SocketModeClient, 'disconnect'>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  try {
    const result = await Promise.race([client.disconnect().then(() => 'closed' as const), timedOut]);
    if (result === 'timeout') console.warn('[slack-socket] disconnect did not complete in time; continuing shutdown');
  } catch (error) {
    console.warn(`[slack-socket] disconnect failed: ${formatSlackSocketError(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

type CachedChannelLabel = {
  label: string;
  expiresAt: number;
};

function isUserMessage(event: Record<string, unknown>): boolean {
  if (!isMessageWithText(event)) return false;
  if (event.bot_id) return false;
  return Boolean(event.ts && event.channel);
}

export class SlackSocketModeListener {
  private client?: SocketModeClient;
  private web?: WebClient;
  private channelLabels = new Map<string, CachedChannelLabel>();
  private readonly channelLabelLookups = new Map<string, Promise<string>>();
  private onEvent?: SlackSocketEventHandler;
  private onStateChange?: PushTransportStateHandler;
  private lastSocketError?: string;
  private lastLoggedSocketError?: string;
  private lifecycleGeneration = 0;
  private botToken?: string;
  private appToken?: string;
  /** Bumped for every client the listener opens, so a replaced client's late events are ignored. */
  private socketEpoch = 0;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recoveryAttempts = 0;

  constructor(
    private readonly options: SlackSocketModeListenerOptions = {},
  ) {}

  async start(
    botToken: string,
    appToken: string,
    onEvent: SlackSocketEventHandler,
    onStateChange?: PushTransportStateHandler,
  ): Promise<void> {
    const stopping = this.stop();
    const generation = this.lifecycleGeneration;
    await stopping;
    if (generation !== this.lifecycleGeneration) return;

    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
    this.botToken = botToken;
    this.appToken = appToken;
    this.lastSocketError = undefined;
    this.lastLoggedSocketError = undefined;
    this.recoveryAttempts = 0;
    this.socketEpoch += 1;
    await this.openClient(generation, this.socketEpoch, botToken, appToken);
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.clearRecoveryWatchdog();
    this.recoveryAttempts = 0;
    const client = this.client;
    this.client = undefined;
    this.web = undefined;
    this.onEvent = undefined;
    this.onStateChange = undefined;
    this.botToken = undefined;
    this.appToken = undefined;
    this.lastSocketError = undefined;
    this.lastLoggedSocketError = undefined;
    this.channelLabels.clear();
    this.channelLabelLookups.clear();
    if (client) await disconnectWithin(client, SLACK_DISCONNECT_TIMEOUT_MS);
  }

  isRunning(): boolean {
    return this.client?.websocket?.isActive() ?? false;
  }

  /** Creates one SDK client and wires its events. Events from any other lifecycle or epoch are dropped. */
  private async openClient(generation: number, epoch: number, botToken: string, appToken: string): Promise<void> {
    const [{ SocketModeClient, LogLevel }, { WebClient }] = await Promise.all([
      import('@slack/socket-mode'),
      import('@slack/web-api'),
    ]);
    const current = () => generation === this.lifecycleGeneration && epoch === this.socketEpoch;
    if (!current()) return;
    const sdkLogger = createSlackSdkLogger(LogLevel);
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
      if (!current()) return;
      if (state.error) this.lastSocketError = state.error;
      if (state.phase === 'connected') {
        this.lastSocketError = undefined;
        this.lastLoggedSocketError = undefined;
        this.recoveryAttempts = 0;
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
    client.on('connecting', () => {
      this.clearRecoveryWatchdog();
      notify({ phase: 'connecting' });
    });
    client.on('connected', () => {
      this.clearRecoveryWatchdog();
      notify({ phase: 'connected' });
    });
    client.on('reconnecting', () => {
      this.armRecoveryWatchdog(generation, epoch);
      notify({ phase: 'reconnecting' });
    });
    client.on('close', () => notify({ phase: 'reconnecting' }));
    client.on('disconnected', () => notify({ phase: 'disconnected' }));
    client.on('error', reportError);

    client.on('events_api', async ({ event, ack }) => {
      try {
        if (!current()) return;
        if (!isUserMessage(event as Record<string, unknown>)) {
          await ack();
          return;
        }

        const message = event as {
          type: 'message';
          channel: string;
          ts: string;
          text?: string;
          user?: string;
        };

        const channelId = message.channel;
        const web = this.web;
        const accepted = await this.onEvent?.(async () => ({
          type: 'slack.new_message',
          payload: {
            messageId: message.ts,
            ts: message.ts,
            channel: await this.resolveChannelLabel(channelId, generation, web),
            channelId,
            text: message.text ?? '',
            user: message.user,
            sender: message.user,
          },
        }));
        if (accepted !== false) await ack();
      } catch (error) {
        reportError(error);
      }
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
      if (current()) reportError(error);
    });
  }

  private armRecoveryWatchdog(generation: number, epoch: number): void {
    if (this.recoveryTimer) return;
    const base = this.options.recoveryWatchdogMs ?? SLACK_RECOVERY_WATCHDOG_MS;
    const delay = Math.min(base * 2 ** this.recoveryAttempts, SLACK_RECOVERY_WATCHDOG_MAX_MS);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (generation !== this.lifecycleGeneration || epoch !== this.socketEpoch) return;
      void this.restartSocket(generation);
    }, delay);
  }

  private clearRecoveryWatchdog(): void {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  private async restartSocket(generation: number): Promise<void> {
    const botToken = this.botToken;
    const appToken = this.appToken;
    if (!botToken || !appToken || generation !== this.lifecycleGeneration) return;
    this.recoveryAttempts += 1;
    const old = this.client;
    this.client = undefined;
    this.socketEpoch += 1;
    const epoch = this.socketEpoch;
    this.onStateChange?.({ phase: 'connecting' });
    if (old) await disconnectWithin(old, SLACK_DISCONNECT_TIMEOUT_MS);
    if (generation !== this.lifecycleGeneration || epoch !== this.socketEpoch) return;
    await this.openClient(generation, epoch, botToken, appToken);
  }

  private async resolveChannelLabel(
    channelId: string,
    generation: number,
    web: WebClient | undefined,
  ): Promise<string> {
    const cached = this.channelLabels.get(channelId);
    if (cached && cached.expiresAt > Date.now()) {
      // Keep frequently used channels at the newest end of the bounded cache.
      this.channelLabels.delete(channelId);
      this.channelLabels.set(channelId, cached);
      return cached.label;
    }
    if (cached) this.channelLabels.delete(channelId);

    const pending = this.channelLabelLookups.get(channelId);
    if (pending) return pending;

    const lookup = (async () => {
      try {
        const response = await web?.conversations.info({ channel: channelId });
        const name = response?.channel?.name;
        const label = name ? `#${name}` : channelId;
        if (generation === this.lifecycleGeneration) {
          this.channelLabels.set(channelId, {
            label,
            expiresAt: Date.now() + SLACK_CHANNEL_LABEL_CACHE_TTL_MS,
          });
          while (this.channelLabels.size > SLACK_CHANNEL_LABEL_CACHE_MAX) {
            const oldest = this.channelLabels.keys().next().value as string | undefined;
            if (!oldest) break;
            this.channelLabels.delete(oldest);
          }
        }
        return label;
      } catch {
        return channelId;
      }
    })();
    this.channelLabelLookups.set(channelId, lookup);
    try {
      return await lookup;
    } finally {
      if (this.channelLabelLookups.get(channelId) === lookup) {
        this.channelLabelLookups.delete(channelId);
      }
    }
  }
}

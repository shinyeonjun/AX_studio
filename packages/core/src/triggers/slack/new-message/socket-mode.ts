import { LogLevel, SocketModeClient, type Logger, type SocketModeOptions } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { TriggerEvent } from '../../types.js';
import type { PushTransportState, PushTransportStateHandler } from '../../push-state.js';

export type SlackSocketEventHandler = (event: TriggerEvent) => void;

export interface SlackSocketModeListenerOptions {
  createClient?: (options: SocketModeOptions) => SocketModeClient;
}

// The SDK default is 5 seconds. A desktop app can be briefly deprioritized by the OS
// or delayed by a proxy without the Slack connection actually being dead.
const SLACK_CLIENT_PING_TIMEOUT_MS = 15_000;
const MAX_SLACK_ERROR_DETAILS = 8;
const MAX_SLACK_ERROR_DETAIL_LENGTH = 240;
const SLACK_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const SLACK_TOKEN_PATTERN = /\b(?:xapp|xoxb|xoxp|xoxa|xoxs)-[A-Za-z0-9-]+/gi;
const NESTED_ERROR_KEYS = ['original', 'cause', 'error', 'reason'] as const;

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function redactSlackErrorText(value: string): string {
  return value
    .trim()
    .replace(SLACK_URL_PATTERN, '[REDACTED_URL]')
    .replace(SLACK_TOKEN_PATTERN, '[REDACTED_SLACK_TOKEN]')
    .slice(0, MAX_SLACK_ERROR_DETAIL_LENGTH)
    .trim();
}

function formatSlackSdkLog(values: Parameters<Logger['error']>): string {
  return values
    .map((value) => {
      if (typeof value === 'string') return redactSlackErrorText(value);
      if (value instanceof Error) return formatSlackSocketError(value);
      if (value && typeof value === 'object') {
        const message = readProperty(value, 'message');
        return typeof message === 'string' ? redactSlackErrorText(message) : '';
      }
      return String(value);
    })
    .filter(Boolean)
    .join(' ');
}

/** Keep the SDK's duplicate WebSocket wrapper logs behind the app-level diagnostic. */
class SlackSdkLogger implements Logger {
  private level = LogLevel.ERROR;
  private name = 'slack-sdk';
  private lastError = '';

  debug(..._msg: Parameters<Logger['debug']>): void {}

  info(..._msg: Parameters<Logger['info']>): void {}

  warn(...msg: Parameters<Logger['warn']>): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    const detail = formatSlackSdkLog(msg);
    if (detail) console.warn(`[${this.name}] ${detail}`);
  }

  error(...msg: Parameters<Logger['error']>): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    const detail = formatSlackSdkLog(msg);
    if (!detail || /^WebSocket error(?: occurred:|!)/.test(detail)) return;
    if (detail === this.lastError) return;
    this.lastError = detail;
    console.error(`[${this.name}] ${detail}`);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setName(name: string): void {
    this.name = name;
  }

  private shouldLog(level: LogLevel): boolean {
    const severity = {
      [LogLevel.DEBUG]: 100,
      [LogLevel.INFO]: 200,
      [LogLevel.WARN]: 300,
      [LogLevel.ERROR]: 400,
    };
    return severity[level] >= severity[this.level];
  }

  resetError(): void {
    this.lastError = '';
  }
}

/** Preserve bounded nested transport details instead of exposing only SMWebsocketError. */
export function formatSlackSocketError(error: unknown): string {
  const details: string[] = [];
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  let fallbackName = '';

  const addDetail = (value: unknown) => {
    if (typeof value !== 'string') return;
    const detail = redactSlackErrorText(value);
    if (detail && !details.includes(detail) && details.length < MAX_SLACK_ERROR_DETAILS) {
      details.push(detail);
    }
  };

  while (queue.length > 0 && details.length < MAX_SLACK_ERROR_DETAILS) {
    const current = queue.shift();
    if (typeof current === 'string') {
      addDetail(current);
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (current instanceof Error) {
      if (!current.message) fallbackName = current.name;
      else fallbackName ||= current.name;
      addDetail(current.message);
      const code = readProperty(current, 'code');
      if (typeof code === 'string' && code !== 'slack_socket_mode_websocket_error') addDetail(code);
    } else {
      addDetail(readProperty(current, 'message'));
      addDetail(readProperty(current, 'code'));
    }

    for (const key of NESTED_ERROR_KEYS) {
      const nested = readProperty(current, key);
      if (nested !== undefined) queue.push(nested);
    }
  }

  if (details.length > 0) return details.join(' | ');
  if (fallbackName === 'TypeError') {
    return 'TypeError (Slack WebSocket transport returned no diagnostic detail)';
  }
  return fallbackName || 'Slack Socket Mode error';
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
    const sdkLogger = new SlackSdkLogger();
    const client = (this.options.createClient ?? ((clientOptions) => new SocketModeClient(clientOptions)))({
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

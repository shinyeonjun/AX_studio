import { LogLevel, type Logger } from '@slack/socket-mode';

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

export function createSlackSdkLogger(): Logger & { resetError(): void } {
  return new SlackSdkLogger();
}

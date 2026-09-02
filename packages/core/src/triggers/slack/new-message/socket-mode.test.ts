import { EventEmitter } from 'node:events';
import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import { describe, expect, it, vi } from 'vitest';
import { formatSlackSocketError, SlackSocketModeListener } from './socket-mode.js';

describe('formatSlackSocketError', () => {
  it('keeps the SDK wrapper and its original transport error', () => {
    const original = new Error('ECONNRESET');
    const wrapped = new Error('', { cause: original });
    Object.assign(wrapped, { original });

    expect(formatSlackSocketError(wrapped)).toBe('ECONNRESET');
  });

  it('uses a useful fallback when the SDK error has no message', () => {
    const error = new Error();

    expect(formatSlackSocketError(error)).toBe('Error');
  });

  it('keeps the underlying TypeError visible when the SDK supplied no detail', () => {
    const error = Object.assign(new Error(), { original: new TypeError() });

    expect(formatSlackSocketError(error)).toBe(
      'TypeError (Slack WebSocket transport returned no diagnostic detail)',
    );
  });

  it('walks through nested transport causes and redacts tokens and signed URLs', () => {
    const transportCause = Object.assign(new Error('connect wss://example.test/socket failed for xapp-sensitive'), {
      code: 'ECONNREFUSED',
    });
    const transportError = Object.assign(new TypeError(), { cause: transportCause });
    const wrapped = Object.assign(new Error('', { cause: transportError }), { original: transportError });

    const detail = formatSlackSocketError(wrapped);

    expect(detail).toContain('ECONNREFUSED');
    expect(detail).toContain('[REDACTED_URL]');
    expect(detail).not.toContain('example.test');
    expect(detail).not.toContain('xapp-sensitive');
  });

  it('extracts a non-Error SDK payload instead of collapsing it to TypeError', () => {
    const error = Object.assign(new Error(), {
      original: {
        cause: { message: 'socket handshake failed', code: 'UND_ERR_CONNECT_TIMEOUT' },
      },
    });

    expect(formatSlackSocketError(error)).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(formatSlackSocketError(error)).toContain('socket handshake failed');
  });
});

describe('SlackSocketModeListener lifecycle', () => {
  it('does not block the desktop connection flow while the SDK keeps reconnecting', async () => {
    const client = new EventEmitter() as EventEmitter & {
      start: () => Promise<never>;
      disconnect: () => Promise<void>;
      websocket: { isActive: () => boolean };
    };
    client.websocket = { isActive: () => false };
    client.disconnect = vi.fn(async () => undefined);
    const socketCause = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
    const socketError = Object.assign(new TypeError(), { cause: socketCause });
    const sdkError = Object.assign(new Error('', { cause: socketError }), { original: socketError });
    client.start = vi.fn(async () => {
      client.emit('error', sdkError);
      client.emit('error', sdkError);
      return await new Promise<never>(() => undefined);
    });

    const states: Array<{ phase: string; error?: string }> = [];
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let sdkLogger: SocketModeOptions['logger'];
    const listener = new SlackSocketModeListener({
      createClient: (options) => {
        sdkLogger = options.logger;
        return client as unknown as SocketModeClient;
      },
    });

    try {
      const result = await Promise.race([
        listener.start('xoxb-test', 'xapp-test', () => undefined, (state) => states.push(state)),
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
      ]);

      expect(result).not.toBe('timed-out');
      expect(client.start).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledOnce();
      expect(states).toContainEqual({ phase: 'error', error: 'fetch failed | ECONNRESET' });
      expect(sdkLogger).toBeDefined();
      sdkLogger?.error('WebSocket error occurred:');
      sdkLogger?.error('WebSocket error! SMWebsocketError');
      expect(logSpy).toHaveBeenCalledOnce();
    } finally {
      await listener.stop();
      logSpy.mockRestore();
    }

    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});

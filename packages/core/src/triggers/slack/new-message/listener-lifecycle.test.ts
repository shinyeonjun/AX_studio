import { EventEmitter } from 'node:events';
import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import { describe, expect, it, vi } from 'vitest';
import { SlackSocketModeListener } from './socket-mode.js';

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

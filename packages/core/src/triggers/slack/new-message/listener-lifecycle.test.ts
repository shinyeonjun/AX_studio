import { EventEmitter } from 'node:events';
import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import { describe, expect, it, vi } from 'vitest';
import { SlackSocketModeListener } from './socket-mode.js';

const channelInfo = vi.hoisted(() => vi.fn());
vi.mock('@slack/web-api', () => ({
  WebClient: class { conversations = { info: channelInfo }; },
}));

describe('SlackSocketModeListener lifecycle', () => {
  it('preserves the newest connection when an older disconnect finishes late', async () => {
    let finishDisconnect!: () => void;
    const clients: EventEmitter[] = [];
    const createClient = vi.fn(() => {
      const first = clients.length === 0;
      const client = Object.assign(new EventEmitter(), {
        start: vi.fn(async () => undefined),
        disconnect: vi.fn(() => first
          ? new Promise<void>(resolve => { finishDisconnect = resolve; })
          : Promise.resolve()),
        websocket: { isActive: () => true },
      });
      clients.push(client);
      return client as unknown as SocketModeClient;
    });
    const listener = new SlackSocketModeListener({ createClient });
    const obsoleteEvents = vi.fn();
    const latestEvents = vi.fn();
    channelInfo.mockReset().mockResolvedValue({ channel: { name: 'latest' } });
    await listener.start('first', 'first', () => undefined);
    const supersededStart = listener.start('obsolete', 'obsolete', obsoleteEvents);
    await listener.start('latest', 'latest', latestEvents);
    finishDisconnect();
    await supersededStart;
    try {
      expect(createClient).toHaveBeenCalledTimes(2);
      expect(listener.isRunning()).toBe(true);
      await clients[1]!.listeners('events_api')[0]!({
        event: { type: 'message', channel: 'C1', ts: '3', text: 'latest' },
        ack: async () => undefined,
      });
      expect(obsoleteEvents).not.toHaveBeenCalled();
      expect(latestEvents).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        payload: expect.objectContaining({ text: 'latest', channel: '#latest' }),
      }));
    } finally { await listener.stop(); }
  });

  it('keeps a stop requested while start is yielding from opening a socket', async () => {
    const createClient = vi.fn(() => Object.assign(new EventEmitter(), {
      start: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined),
    }) as unknown as SocketModeClient);
    const listener = new SlackSocketModeListener({ createClient });
    const starting = listener.start('bot', 'app', () => undefined);
    await listener.stop();
    await starting;
    expect(createClient).not.toHaveBeenCalled();
    expect(listener.isRunning()).toBe(false);
  });

  it('does not deliver or cache a retired connection event after reconnecting', async () => {
    const clients: Array<EventEmitter & { start: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const listener = new SlackSocketModeListener({ createClient: () => {
      const client = Object.assign(new EventEmitter(), { start: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) });
      clients.push(client);
      return client as unknown as SocketModeClient;
    } });
    const oldEvents = vi.fn();
    const newEvents = vi.fn();
    let finishLookup!: (value: unknown) => void;
    channelInfo.mockReset().mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }))
      .mockResolvedValue({ channel: { name: 'new-workspace' } });
    try {
      await listener.start('old-bot', 'old-app', oldEvents);
      const deliver = clients[0]!.listeners('events_api')[0]!;
      const pending = deliver({ event: { type: 'message', channel: 'C1', ts: '1', text: 'old' }, ack: async () => undefined });
      await vi.waitFor(() => expect(channelInfo).toHaveBeenCalledOnce());
      await listener.start('new-bot', 'new-app', newEvents);
      finishLookup({ channel: { name: 'old-workspace' } });
      await pending;
      expect(oldEvents).not.toHaveBeenCalled();
      expect(newEvents).not.toHaveBeenCalled();
      await clients[1]!.listeners('events_api')[0]!({ event: { type: 'message', channel: 'C1', ts: '2', text: 'new' }, ack: async () => undefined });
      expect(newEvents).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payload: expect.objectContaining({ channel: '#new-workspace', text: 'new' }) }));
      expect(channelInfo).toHaveBeenCalledTimes(2);
    } finally { await listener.stop(); }
  });

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

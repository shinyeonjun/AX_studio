import { EventEmitter } from 'node:events';
import type { SocketModeClient, SocketModeOptions } from '@slack/socket-mode';
import { describe, expect, it, vi } from 'vitest';
import type { TriggerEvent } from '../../types.js';
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
    let latestEvent: TriggerEvent | undefined;
    const latestEvents = vi.fn(async (createEvent: () => Promise<TriggerEvent>) => {
      latestEvent = await createEvent();
    });
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
      expect(latestEvents).toHaveBeenCalledOnce();
      expect(latestEvent).toEqual(expect.objectContaining({
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

  it('does not ACK an event delivered by a retired socket generation', async () => {
    const clients: EventEmitter[] = [];
    const listener = new SlackSocketModeListener({ createClient: () => {
      const client = Object.assign(new EventEmitter(), {
        start: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
      });
      clients.push(client);
      return client as unknown as SocketModeClient;
    } });
    const currentEvents = vi.fn();
    try {
      await listener.start('old-bot', 'old-app', vi.fn());
      const retiredHandler = clients[0]!.listeners('events_api')[0]!;
      await listener.start('new-bot', 'new-app', currentEvents);
      const ack = vi.fn(async () => undefined);

      await retiredHandler({
        event: { type: 'message', channel: 'C1', ts: 'old-event', text: 'retry me' },
        ack,
      });

      expect(ack).not.toHaveBeenCalled();
      expect(currentEvents).not.toHaveBeenCalled();
    } finally { await listener.stop(); }
  });

  it('does not cache a retired connection channel lookup after reconnecting', async () => {
    const clients: Array<EventEmitter & { start: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const listener = new SlackSocketModeListener({ createClient: () => {
      const client = Object.assign(new EventEmitter(), { start: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) });
      clients.push(client);
      return client as unknown as SocketModeClient;
    } });
    const oldEventPromises: Array<Promise<TriggerEvent>> = [];
    const oldEvents = vi.fn((createEvent: () => Promise<TriggerEvent>) => {
      oldEventPromises.push(createEvent());
      return true;
    });
    let newEvent: TriggerEvent | undefined;
    const newEvents = vi.fn(async (createEvent: () => Promise<TriggerEvent>) => {
      newEvent = await createEvent();
    });
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
      expect(oldEvents).toHaveBeenCalledOnce();
      expect(await oldEventPromises[0]).toEqual(expect.objectContaining({
        payload: expect.objectContaining({ channel: '#old-workspace' }),
      }));
      await clients[1]!.listeners('events_api')[0]!({ event: { type: 'message', channel: 'C1', ts: '2', text: 'new' }, ack: async () => undefined });
      expect(newEvents).toHaveBeenCalledOnce();
      expect(newEvent).toEqual(expect.objectContaining({ payload: expect.objectContaining({ channel: '#new-workspace', text: 'new' }) }));
      expect(channelInfo).toHaveBeenCalledTimes(2);
    } finally { await listener.stop(); }
  });

  it('reuses a fresh channel label instead of calling Slack for every message', async () => {
    const client = Object.assign(new EventEmitter(), {
      start: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      websocket: { isActive: () => true },
    }) as unknown as SocketModeClient;
    const listener = new SlackSocketModeListener({ createClient: () => client });
    const onEvent = vi.fn(async (createEvent: () => Promise<TriggerEvent>) => { await createEvent(); });
    channelInfo.mockReset().mockResolvedValue({ channel: { name: 'general' } });
    try {
      await listener.start('bot', 'app', onEvent);
      const deliver = client.listeners('events_api')[0]!;
      await deliver({ event: { type: 'message', channel: 'C1', ts: '1', text: 'one' }, ack: async () => undefined });
      await deliver({ event: { type: 'message', channel: 'C1', ts: '2', text: 'two' }, ack: async () => undefined });
      expect(channelInfo).toHaveBeenCalledOnce();
    } finally { await listener.stop(); }
  });

  it('shares an in-flight channel lookup across concurrent messages', async () => {
    const client = Object.assign(new EventEmitter(), {
      start: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      websocket: { isActive: () => true },
    }) as unknown as SocketModeClient;
    const listener = new SlackSocketModeListener({ createClient: () => client });
    let finishLookup!: (value: unknown) => void;
    channelInfo.mockReset().mockImplementation(() => new Promise((resolve) => { finishLookup = resolve; }));
    const onEvent = vi.fn(async (createEvent: () => Promise<TriggerEvent>) => { await createEvent(); });
    try {
      await listener.start('bot', 'app', onEvent);
      const deliver = client.listeners('events_api')[0]!;
      const pending = [
        deliver({ event: { type: 'message', channel: 'C1', ts: '1', text: 'one' }, ack: async () => undefined }),
        deliver({ event: { type: 'message', channel: 'C1', ts: '2', text: 'two' }, ack: async () => undefined }),
      ];
      await vi.waitFor(() => expect(channelInfo).toHaveBeenCalledOnce());
      finishLookup({ channel: { name: 'general' } });
      await Promise.all(pending);

      expect(channelInfo).toHaveBeenCalledOnce();
      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(await onEvent.mock.calls[0]![0]()).toEqual(expect.objectContaining({
        payload: expect.objectContaining({ channel: '#general' }),
      }));
    } finally { await listener.stop(); }
  });

  it('acknowledges only after the event is admitted for processing', async () => {
    const client = Object.assign(new EventEmitter(), {
      start: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      websocket: { isActive: () => true },
    }) as unknown as SocketModeClient;
    const listener = new SlackSocketModeListener({ createClient: () => client });
    const sequence: string[] = [];
    let accepted = false;
    channelInfo.mockReset().mockResolvedValue({ channel: { name: 'general' } });
    try {
      await listener.start('bot', 'app', vi.fn(async () => {
        sequence.push('admission');
        return accepted;
      }));
      const deliver = client.listeners('events_api')[0]!;
      const rejectedAck = vi.fn(async () => { sequence.push('ack'); });
      await deliver({
        event: { type: 'message', channel: 'C1', ts: '1', text: 'rejected' },
        ack: rejectedAck,
      });
      expect(rejectedAck).not.toHaveBeenCalled();

      accepted = true;
      const acceptedAck = vi.fn(async () => { sequence.push('ack'); });
      await deliver({
        event: { type: 'message', channel: 'C1', ts: '2', text: 'accepted' },
        ack: acceptedAck,
      });
      expect(acceptedAck).toHaveBeenCalledOnce();
      expect(sequence).toEqual(['admission', 'admission', 'ack']);
    } finally { await listener.stop(); }
  });

  it('retains the original Slack lookup client until an admitted lazy event is drained', async () => {
    const client = Object.assign(new EventEmitter(), {
      start: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      websocket: { isActive: () => true },
    }) as unknown as SocketModeClient;
    const listener = new SlackSocketModeListener({ createClient: () => client });
    let createEvent: (() => Promise<TriggerEvent>) | undefined;
    channelInfo.mockReset().mockResolvedValue({ channel: { name: 'queued-channel' } });
    try {
      await listener.start('bot', 'app', (factory) => {
        createEvent = factory;
        return true;
      });
      await client.listeners('events_api')[0]!({
        event: { type: 'message', channel: 'C1', ts: 'queued', text: 'queued' },
        ack: vi.fn(async () => undefined),
      });
      await listener.stop();

      expect(await createEvent?.()).toEqual(expect.objectContaining({
        payload: expect.objectContaining({ channel: '#queued-channel' }),
      }));
      expect(channelInfo).toHaveBeenCalledOnce();
    } finally { await listener.stop(); }
  });

  it('does not block the desktop connection flow while the SDK keeps reconnecting', async () => {
    await Promise.all([import('@slack/socket-mode'), import('@slack/web-api')]);
    const client = new EventEmitter() as EventEmitter & {
      start: () => Promise<void>;
      disconnect: () => Promise<void>;
      websocket: { isActive: () => boolean };
    };
    client.websocket = { isActive: () => false };
    let finishStart!: () => void;
    client.disconnect = vi.fn(async () => { finishStart?.(); });
    const socketCause = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
    const socketError = Object.assign(new TypeError(), { cause: socketCause });
    const sdkError = Object.assign(new Error('', { cause: socketError }), { original: socketError });
    client.start = vi.fn(() => {
      client.emit('error', sdkError);
      client.emit('error', sdkError);
      return new Promise<void>((resolve) => { finishStart = resolve; });
    });

    const states: Array<{ phase: string; error?: string }> = [];
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let finishTimeout!: () => void;
    let sdkLogger: SocketModeOptions['logger'];
    const listener = new SlackSocketModeListener({
      createClient: (options) => {
        sdkLogger = options.logger;
        return client as unknown as SocketModeClient;
      },
    });

    try {
      const result = await Promise.race([
        listener.start('xoxb-test', 'xapp-test', () => undefined, (state) => states.push(state))
          .then(() => 'started' as const),
        new Promise<'timed-out'>((resolve) => {
          finishTimeout = () => resolve('timed-out');
          timeout = setTimeout(finishTimeout, 50);
        }),
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
      clearTimeout(timeout);
      finishTimeout?.();
      await listener.stop();
      logSpy.mockRestore();
    }

    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});

import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';
import { pollSlackNewMessages } from './new-message-poll.js';

describe('pollSlackNewMessages', () => {
  it('collects every history page and emits new user messages in timestamp order', async () => {
    const history = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          { type: 'message', ts: '103.000', text: 'third', user: 'U3' },
          { type: 'message', subtype: 'bot_message', ts: '102.500', text: 'bot' },
          { type: 'message', ts: '102.000', text: 'second', user: 'U2' },
        ],
        response_metadata: { next_cursor: 'page-2' },
      })
      .mockResolvedValueOnce({
        messages: [
          { type: 'message', ts: '101.000', text: 'first', user: 'U1' },
          { type: 'message', ts: '100.000', text: 'already seen', user: 'U0' },
        ],
        response_metadata: { next_cursor: '' },
      });
    const client = { conversations: { history } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#general',
      cursorChannel: '#general',
      channelId: 'C123',
      initialized: true,
      lastMessageTs: '100.000',
    });

    expect(history).toHaveBeenNthCalledWith(1, {
      channel: 'C123',
      limit: 100,
      cursor: undefined,
      oldest: '100.000',
    });
    expect(history).toHaveBeenNthCalledWith(2, {
      channel: 'C123',
      limit: 100,
      cursor: 'page-2',
      oldest: '100.000',
    });
    expect(result.events.map((event) => event.payload.messageId)).toEqual([
      '101.000',
      '102.000',
      '103.000',
    ]);
    expect(result.cursor).toEqual({
      initialized: true,
      channel: '#general',
      channelId: 'C123',
      lastMessageTs: '103.000',
    });
  });

  it('uses only the first history page when establishing the initial cursor', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '200.000', text: 'latest', user: 'U1' }],
      response_metadata: { next_cursor: 'older-page' },
    });
    const client = { conversations: { history } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#general',
      channelId: 'C123',
      initialized: false,
    });

    expect(history).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      events: [],
      cursor: {
        initialized: true,
        channel: '#general',
        channelId: 'C123',
        lastMessageTs: '200.000',
      },
    });
  });

  it('stops polling history when Slack repeats a pagination cursor', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '201.000', text: 'new', user: 'U1' }],
      response_metadata: { next_cursor: 'repeated' },
    });
    const client = { conversations: { history } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#general',
      cursorChannel: '#general',
      channelId: 'C123',
      initialized: true,
      lastMessageTs: '200.000',
    });

    expect(history).toHaveBeenCalledTimes(2);
    expect(result.events).toHaveLength(1);
  });

  it('resolves and baselines a newly configured channel instead of reusing the old channel id', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '300.000', text: 'existing', user: 'U1' }],
      response_metadata: { next_cursor: '' },
    });
    const list = vi.fn().mockResolvedValue({
      channels: [{ id: 'C_RANDOM', name: 'random' }],
      response_metadata: { next_cursor: '' },
    });
    const client = { conversations: { history, list } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#random',
      cursorChannel: '#general',
      channelId: 'C_GENERAL',
      initialized: true,
      lastMessageTs: '200.000',
    });

    expect(list).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledWith({
      channel: 'C_RANDOM',
      limit: 100,
      cursor: undefined,
      oldest: undefined,
    });
    expect(result).toEqual({
      events: [],
      cursor: {
        initialized: true,
        channel: '#random',
        channelId: 'C_RANDOM',
        lastMessageTs: '300.000',
      },
    });
  });

  it('upgrades a legacy cursor without rebaselining when its channel id still matches', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '201.000', text: 'new', user: 'U1' }],
      response_metadata: { next_cursor: '' },
    });
    const list = vi.fn().mockResolvedValue({
      channels: [{ id: 'C_GENERAL', name: 'general' }],
      response_metadata: { next_cursor: '' },
    });
    const client = { conversations: { history, list } } as unknown as WebClient;

    const result = await pollSlackNewMessages(client, {
      channel: '#general',
      channelId: 'C_GENERAL',
      initialized: true,
      lastMessageTs: '200.000',
    });

    expect(history).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'C_GENERAL',
      oldest: '200.000',
    }));
    expect(result.events.map((event) => event.payload.messageId)).toEqual(['201.000']);
    expect(result.cursor.channel).toBe('#general');
  });
});

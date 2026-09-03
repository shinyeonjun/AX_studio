import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';
import { listSlackChannels, readSlackChannelMessages, searchSlackMessages } from '../read.js';

describe('Slack read knowledge', () => {
  it('stops listing channels when Slack repeats a pagination cursor', async () => {
    const list = vi.fn().mockResolvedValue({
      channels: [{ id: 'C123', name: 'general' }],
      response_metadata: { next_cursor: 'repeated' },
    });
    const client = { conversations: { list } } as unknown as WebClient;

    const channels = await listSlackChannels(client);

    expect(list).toHaveBeenCalledTimes(2);
    expect(channels).toHaveLength(1);
  });

  it('reads additional history pages to fill the requested user-message limit', async () => {
    const history = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          { type: 'message', subtype: 'channel_join', ts: '104.000', text: 'joined' },
          { type: 'message', ts: '103.000', text: 'third', user: 'U3' },
          { type: 'message', subtype: 'bot_message', ts: '102.500', text: 'bot' },
        ],
        response_metadata: { next_cursor: 'page-2' },
      })
      .mockResolvedValueOnce({
        messages: [
          { type: 'message', ts: '102.000', text: 'second', user: 'U2' },
          { type: 'message', ts: '101.000', text: 'first', user: 'U1' },
          { type: 'message', ts: '100.000', text: 'outside limit', user: 'U0' },
        ],
        response_metadata: { next_cursor: 'page-3' },
      });
    const client = { conversations: { history } } as unknown as WebClient;

    const result = await readSlackChannelMessages(client, 'C123', 3);

    expect(history).toHaveBeenNthCalledWith(1, { channel: 'C123', limit: 3, cursor: undefined });
    expect(history).toHaveBeenNthCalledWith(2, { channel: 'C123', limit: 3, cursor: 'page-2' });
    expect(history).toHaveBeenCalledTimes(2);
    expect(result.messages.map((message) => message.ts)).toEqual(['103.000', '102.000', '101.000']);
  });

  it('normalizes fractional read limits before calling Slack', async () => {
    const history = vi.fn().mockResolvedValue({ messages: [] });
    const client = { conversations: { history } } as unknown as WebClient;

    await readSlackChannelMessages(client, 'C123', 2.8);

    expect(history).toHaveBeenCalledWith({ channel: 'C123', limit: 2, cursor: undefined });
  });

  it('stops reading history when Slack repeats a pagination cursor', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '101.000', text: 'message', user: 'U1' }],
      response_metadata: { next_cursor: 'repeated' },
    });
    const client = { conversations: { history } } as unknown as WebClient;

    const result = await readSlackChannelMessages(client, 'C123', 10);

    expect(history).toHaveBeenCalledTimes(2);
    expect(result.messages).toHaveLength(1);
  });

  it('stops resolving a missing channel when Slack repeats a pagination cursor', async () => {
    const list = vi.fn().mockResolvedValue({
      channels: [],
      response_metadata: { next_cursor: 'repeated' },
    });
    const history = vi.fn();
    const client = { conversations: { list, history } } as unknown as WebClient;

    await expect(readSlackChannelMessages(client, '#missing')).rejects.toThrow('channel_not_found');

    expect(list).toHaveBeenCalledTimes(2);
    expect(history).not.toHaveBeenCalled();
  });

  it('uses the default search limit for non-finite values', async () => {
    const messages = vi.fn().mockResolvedValue({ messages: { matches: [] } });
    const client = { search: { messages } } as unknown as WebClient;

    await searchSlackMessages(client, 'deploy', Number.NaN);

    expect(messages).toHaveBeenCalledWith({ query: 'deploy', count: 20 });
  });
});

import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';
import { resolveSlackChannelId } from './channel-resolve.js';
import { listSlackChannels, readSlackChannelMessages, searchSlackMessages } from './read.js';
import { pollSlackNewMessages } from './new-message-poll/poll.js';

describe('Slack bounded execution', () => {
  it('fills search results across pages without changing the page size', async () => {
    const messages = vi.fn()
      .mockResolvedValueOnce({ messages: { matches: [{ channel: { id: 'C123' }, ts: '101.000', text: 'one' }], paging: { page: 1, pages: 2 } } })
      .mockResolvedValueOnce({ messages: { matches: [{ channel: { id: 'C123' }, ts: '102.000', text: 'two' }], paging: { page: 2, pages: 2 } } });
    const result = await searchSlackMessages({ search: { messages } } as unknown as WebClient, 'query', 2);
    expect(result.hits).toHaveLength(2);
    expect(messages).toHaveBeenNthCalledWith(2, { query: 'query', count: 2, page: 2 });
  });

  it('continues timestamp pagination when history has_more has no next cursor', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '201.000', text: 'two' }], has_more: true })
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '200.000', text: 'one' }], has_more: false });
    const result = await readSlackChannelMessages({ conversations: { history } } as unknown as WebClient, 'C123', 2);
    expect(result.messages.map((message) => message.ts)).toEqual(['201.000', '200.000']);
    expect(history).toHaveBeenNthCalledWith(2, expect.objectContaining({ latest: '201.000' }));
  });

  it('uses timestamp pagination for polling and emits all events before advancing the checkpoint', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '202.000', text: 'two' }], has_more: true })
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '201.000', text: 'one' }], has_more: false });
    const result = await pollSlackNewMessages({ conversations: { history } } as unknown as WebClient, {
      channel: 'C123', initialized: true, lastMessageTs: '200.000',
    });
    expect(result.events.map((event) => event.payload.ts)).toEqual(['201.000', '202.000']);
    expect(result.cursor.lastMessageTs).toBe('202.000');
    expect(history).toHaveBeenNthCalledWith(2, expect.objectContaining({ oldest: '200.000', latest: '202.000' }));
  });

  it('rejects incomplete history when neither a cursor nor a timestamp can continue it', async () => {
    const history = vi.fn().mockResolvedValue({ messages: [], has_more: true });
    await expect(readSlackChannelMessages({ conversations: { history } } as unknown as WebClient, 'C123'))
      .rejects.toThrow('pagination_incomplete');
    expect(history).toHaveBeenCalledOnce();
  });

  it('stops between history pages when cancelled without producing a checkpoint', async () => {
    const controller = new AbortController();
    const history = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { messages: [{ type: 'message', ts: '201.000' }], response_metadata: { next_cursor: 'next' } };
    });
    await expect(pollSlackNewMessages({ conversations: { history } } as unknown as WebClient, {
      channel: 'C123', initialized: true, lastMessageTs: '200.000',
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(history).toHaveBeenCalledOnce();
  });

  it('bounds collected polling messages without emitting a partial checkpoint', async () => {
    const history = vi.fn().mockResolvedValue({ messages: Array.from({ length: 1001 }, (_, index) => ({
      type: 'message', ts: `${2000 - index}.000`,
    })) });
    await expect(pollSlackNewMessages({ conversations: { history } } as unknown as WebClient, {
      channel: 'C123', initialized: true, lastMessageTs: '0',
    })).rejects.toThrow('message_limit');
    expect(history).toHaveBeenCalledOnce();
  });

  it('returns no partial polling result when a later page fails', async () => {
    const failure = new Error('unavailable');
    const history = vi.fn()
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '201.000' }], response_metadata: { next_cursor: 'next' } })
      .mockRejectedValueOnce(failure);
    await expect(pollSlackNewMessages({ conversations: { history } } as unknown as WebClient, {
      channel: 'C123', initialized: true, lastMessageTs: '200.000',
    })).rejects.toBe(failure);
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('stops duplicate-only search pages at the page bound', async () => {
    const messages = vi.fn().mockResolvedValue({ messages: { matches: [
      { channel: { id: 'C123' }, ts: '201.000' },
    ], paging: { pages: 21 } } });
    await expect(searchSlackMessages({ search: { messages } } as unknown as WebClient, 'query', 2))
      .rejects.toThrow('pagination_limit');
    expect(messages).toHaveBeenCalledTimes(20);
  });

  it('resolves a bare lowercase channel name instead of treating it as an ID', async () => {
    const list = vi.fn().mockResolvedValue({ channels: [{ name: 'general', id: 'C123' }] });
    expect(await resolveSlackChannelId({ conversations: { list } } as unknown as WebClient, 'general')).toBe('C123');
    expect(list).toHaveBeenCalledOnce();
  });

  it('bounds channel listing when empty pages keep returning fresh cursors', async () => {
    const list = vi.fn().mockImplementation(async () => ({
      channels: [], response_metadata: { next_cursor: list.mock.calls.length <= 20 ? `p${list.mock.calls.length}` : '' },
    }));
    await expect(listSlackChannels({ conversations: { list } } as unknown as WebClient)).rejects.toThrow('pagination_limit');
    expect(list).toHaveBeenCalledTimes(20);
  });

  it('does not emit a checkpoint when polling stops at a repeated cursor', async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [{ type: 'message', ts: '201.000', text: 'new' }], response_metadata: { next_cursor: 'repeat' },
    });
    await expect(pollSlackNewMessages({ conversations: { history } } as unknown as WebClient, {
      channel: 'C123', cursorChannel: 'C123', channelId: 'C123', initialized: true, lastMessageTs: '200.000',
    })).rejects.toThrow('pagination_cycle');
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('does not return an empty success when the provider reports a read failure', async () => {
    const history = vi.fn().mockResolvedValue({ ok: false, error: 'missing_scope' });
    await expect(readSlackChannelMessages({ conversations: { history } } as unknown as WebClient, 'C123'))
      .rejects.toThrow('missing_scope');
  });

  it('locally caps search results even if the provider overfills the page', async () => {
    const messages = vi.fn().mockResolvedValue({ messages: { matches: [
      { channel: { id: 'C123' }, ts: '101.000', text: 'one' },
      { channel: { id: 'C123' }, ts: '102.000', text: 'two' },
    ] } });
    const result = await searchSlackMessages({ search: { messages } } as unknown as WebClient, 'query', 1);
    expect(result.hits).toHaveLength(1);
    expect(result.matches).toHaveLength(1);
  });

  it('does not reuse an explicitly stale channel cache while initializing', async () => {
    const history = vi.fn().mockResolvedValue({ messages: [] });
    const list = vi.fn().mockResolvedValue({ channels: [{ id: 'C456', name: 'random' }] });
    const result = await pollSlackNewMessages({ conversations: { history, list } } as unknown as WebClient, {
      channel: '#random', cursorChannel: '#general', channelId: 'C123', initialized: false,
    });
    expect(result.cursor.channelId).toBe('C456');
    expect(history).toHaveBeenCalledWith(expect.objectContaining({ channel: 'C456' }));
  });
});

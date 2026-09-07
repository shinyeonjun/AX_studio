import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailConnector } from './connector.js';
import { parseGmailConnectionConfig } from './connection.js';
import { pollGmailNewMessages } from './new-message-poll.js';
import { searchGmailMessages } from './search.js';

const context = { executionId: 'test', variables: {}, log: () => undefined };
const connector = () => new GmailConnector({ clientId: 'client', refreshToken: 'test-token' });
afterEach(() => vi.restoreAllMocks());

describe('Gmail bounded execution', () => {
  it('preserves the legacy helper array across short pages and duplicate IDs', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: { messages: [{ id: 'a' }], nextPageToken: 'next' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } });
    const gmail = { users: { messages: { list } } } as unknown as gmail_v1.Gmail;
    const result = await searchGmailMessages(gmail, 'invoice', 2);
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]?.[0]).toMatchObject({ q: 'invoice', pageToken: 'next' });
  });

  it('does not issue a request when cancelled before execution', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [] } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...context, abortSignal: controller.signal };
    expect(await connector().execute('messages.search', {}, ctx)).toMatchObject({ ok: false, errorCode: 'cancelled' });
    expect(list).not.toHaveBeenCalled();
  });

  it('returns a failure envelope even when the provider rejects with null', async () => {
    const list = vi.fn().mockRejectedValue(null);
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    expect(await connector().execute('messages.search', {}, context)).toMatchObject({ ok: false, errorCode: 'gmail_error' });
  });

  it('rejects a connection record pointing at another account credential', () => {
    expect(parseGmailConnectionConfig({
      connector: 'gmail', id: 'account-a', account: 'a@example.com', scopes: [], connectedAt: '2026-01-01',
      credentialRef: { connector: 'gmail', connectionId: 'account-b' },
    })).toBeNull();
  });

  it('accepts a connection whose credential reference matches its ID', () => {
    const record = {
      connector: 'gmail', id: 'account-a', account: 'a@example.com', scopes: [], connectedAt: '2026-01-01',
      credentialRef: { connector: 'gmail', connectionId: 'account-a' },
    };
    expect(parseGmailConnectionConfig(record)).toBe(record);
  });

  it('stops searching between pages when the host cancels', async () => {
    const controller = new AbortController();
    const list = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { data: { messages: [{ id: 'a' }], nextPageToken: 'next' } };
    });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    expect(await connector().execute('messages.search', {}, { ...context, abortSignal: controller.signal }))
      .toMatchObject({ ok: false, errorCode: 'cancelled' });
    expect(list).toHaveBeenCalledOnce();
  });

  it('stops hydrating messages after cancellation without returning a checkpoint', async () => {
    const controller = new AbortController();
    const list = vi.fn().mockResolvedValue({ data: {
      historyId: '200', history: [{ messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'b' } }] }],
    } });
    const get = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { data: { labelIds: ['INBOX'] } };
    });
    const gmail = { users: { history: { list }, messages: { get } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(get).toHaveBeenCalledOnce();
  });

  it('bounds polling message hydration before issuing message reads', async () => {
    const list = vi.fn().mockResolvedValue({ data: { historyId: '200', history: [{ messagesAdded:
      Array.from({ length: 501 }, (_, index) => ({ message: { id: `m${index}` } })),
    }] } });
    const get = vi.fn();
    const gmail = { users: { history: { list }, messages: { get } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] }))
      .rejects.toThrow('message_limit');
    expect(get).not.toHaveBeenCalled();
  });

  it.each([[undefined, 10], [2.8, 2], [500, 50], [Number.NaN, 10]])('preserves legacy helper limit %s as %s', async (limit, expected) => {
    const list = vi.fn().mockResolvedValue({ data: { messages: Array.from({ length: 60 }, (_, index) => ({ id: `m${index}` })) } });
    const gmail = { users: { messages: { list } } } as unknown as gmail_v1.Gmail;
    const result = await searchGmailMessages(gmail, '', limit);
    expect(result).toHaveLength(expected!);
    expect(list.mock.calls[0]?.[0].maxResults).toBe(expected);
  });

  it('preserves legacy helper failure when a later page fails', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: { messages: [{ id: 'a' }], nextPageToken: 'next' } })
      .mockRejectedValueOnce(new Error('unavailable'));
    const gmail = { users: { messages: { list } } } as unknown as gmail_v1.Gmail;
    await expect(searchGmailMessages(gmail, '')).rejects.toThrow('unavailable');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not checkpoint an incomplete cyclic history traversal', async () => {
    const list = vi.fn().mockResolvedValue({ data: { historyId: '200', nextPageToken: 'repeat' } });
    const gmail = { users: { history: { list } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] }))
      .rejects.toThrow('pagination_cycle');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not silently reset an expired history checkpoint and skip missed messages', async () => {
    const list = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { code: 404 }));
    const getProfile = vi.fn().mockResolvedValue({ data: { historyId: '500' } });
    const messages = { list: vi.fn().mockResolvedValue({ data: { messages: [] } }) };
    const gmail = { users: { history: { list }, getProfile, messages } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] }))
      .rejects.toThrow('history_expired');
    expect(getProfile).not.toHaveBeenCalled();
    expect(messages.list).not.toHaveBeenCalled();
  });

  it('bounds history requests even when every empty page has a new token', async () => {
    const list = vi.fn().mockImplementation(async () => ({ data: {
      historyId: '200', ...(list.mock.calls.length <= 20 ? { nextPageToken: `p${list.mock.calls.length}` } : {}),
    } }));
    const gmail = { users: { history: { list } } } as unknown as gmail_v1.Gmail;
    await expect(pollGmailNewMessages(gmail, { initialized: true, historyId: '100', seenMessageIds: [] }))
      .rejects.toThrow('pagination_limit');
    expect(list).toHaveBeenCalledTimes(20);
  });
});

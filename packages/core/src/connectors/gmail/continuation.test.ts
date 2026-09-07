import { google, type gmail_v1 } from 'googleapis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailConnector } from './connector.js';
import { GMAIL_CAPABILITIES } from './catalog.js';
import { ConnectorCapabilitySchema } from '../../catalog/capability-types.js';

const context = { executionId: 'pages', variables: {}, log: () => undefined };
afterEach(() => vi.restoreAllMocks());

describe('Gmail public search continuation', () => {
  it('advertises the public paging parameters and output fields', () => {
    const capability = ConnectorCapabilitySchema.parse(GMAIL_CAPABILITIES.find((entry) => entry.id === 'gmail.messages.search'));
    expect(capability.params.map((param) => param.name)).toEqual(['query', 'limit', 'pageToken']);
    expect(capability.io?.outputs).toEqual({ messages: 'TableArtifact', hits: 'TableArtifact', limit: 'JsonArtifact', truncated: 'JsonArtifact' });
    expect(capability.description).toContain('nextPageToken');
  });

  it('reaches every message beyond the first 50 using serialized continuation metadata', async () => {
    const ids = Array.from({ length: 123 }, (_, index) => `m${index}`);
    const list = vi.fn(async (params: { pageToken?: string; maxResults: number }) => {
      const offset = Number(params.pageToken ?? 0);
      const next = offset + params.maxResults;
      return { data: { messages: ids.slice(offset, next).map((id) => ({ id })),
        nextPageToken: next < ids.length ? String(next) : undefined, resultSizeEstimate: ids.length } };
    });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const connector = new GmailConnector({ clientId: 'test', refreshToken: 'test' });
    const found: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const result = JSON.parse(JSON.stringify(await connector.execute('messages.search', { query: 'invoice', limit: 50, pageToken }, context)));
      expect(result.ok).toBe(true);
      expect(result.data.messages.length).toBeLessThanOrEqual(50);
      expect(result.data.truncated).toBe(page < 2);
      expect(result.data.resultSizeEstimate).toBe(123);
      found.push(...result.data.messages.map((message: { id: string }) => message.id));
      pageToken = result.data.nextPageToken;
      expect(list).toHaveBeenCalledTimes(page + 1);
    }
    expect(found).toEqual(ids);
    expect(pageToken).toBeUndefined();
  });

  it('returns an empty intermediate page with its continuation instead of hiding it', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [], nextPageToken: 'later' } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const connector = new GmailConnector({ clientId: 'test', refreshToken: 'test' });
    expect(await connector.execute('messages.search', {}, context)).toMatchObject({ ok: true, data: { messages: [], truncated: true, nextPageToken: 'later' } });
    expect(list).toHaveBeenCalledOnce();
  });

  it.each([null, 42, '', 'x'.repeat(4097)])('rejects invalid page tokens before a request', async (pageToken) => {
    const list = vi.fn();
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const connector = new GmailConnector({ clientId: 'test', refreshToken: 'test' });
    expect(await connector.execute('messages.search', { pageToken }, context)).toMatchObject({ ok: false, errorCode: 'invalid_params' });
    expect(list).not.toHaveBeenCalled();
  });

  it('does not slice an oversized page and lose its omitted messages', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'after-both' } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const connector = new GmailConnector({ clientId: 'test', refreshToken: 'test' });
    expect(await connector.execute('messages.search', { limit: 1 }, context)).toMatchObject({ ok: false, error: 'page_size_exceeded' });
  });

  it('reports a failed continuation without inventing a terminal empty page', async () => {
    const list = vi.fn().mockRejectedValue(new Error('unavailable'));
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const connector = new GmailConnector({ clientId: 'test', refreshToken: 'test' });
    const result = await connector.execute('messages.search', { pageToken: 'tail' }, context);
    expect(result).toMatchObject({ ok: false, error: 'unavailable' });
    expect(result.data).toBeUndefined();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ pageToken: 'tail' }));
  });

  it('omits unknown totals and marks an exhausted page as complete', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [] } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const connector = new GmailConnector({ clientId: 'test', refreshToken: 'test' });
    const result = await connector.execute('messages.search', {}, context);
    expect(result).toMatchObject({ ok: true, data: { messages: [], truncated: false } });
    expect(result.data).not.toHaveProperty('total');
    expect(result.data).not.toHaveProperty('nextPageToken');
  });
});

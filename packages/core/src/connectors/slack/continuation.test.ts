import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackConnector } from './connector.js';
import { SLACK_CAPABILITIES } from './catalog.js';
import { ConnectorCapabilitySchema } from '../../catalog/capability-types.js';

const api = vi.hoisted(() => ({ list: vi.fn(), history: vi.fn(), search: vi.fn() }));
vi.mock('@slack/web-api', () => ({ WebClient: class {
  conversations = { list: api.list, history: api.history };
  search = { messages: api.search };
} }));
const context = { executionId: 'pages', variables: {}, log: () => undefined };
beforeEach(() => vi.resetAllMocks());

describe('Slack public continuation', () => {
  it.each([
    ['slack.channels.list', ['limit', 'cursor'], ['channels', 'limit', 'truncated']],
    ['slack.messages.search', ['query', 'limit', 'cursor', 'page'], ['hits', 'matches', 'limit', 'truncated', 'page']],
    ['slack.messages.read', ['channel', 'limit', 'cursor', 'latest'], ['messages', 'channelId', 'limit', 'truncated']],
  ])('advertises paging inputs and outputs for %s', (id, params, outputs) => {
    const capability = ConnectorCapabilitySchema.parse(SLACK_CAPABILITIES.find((entry) => entry.id === id));
    expect(capability.params.map((param) => param.name)).toEqual(params);
    expect(Object.keys(capability.io!.outputs)).toEqual(outputs);
    expect(capability.description).toContain('nextCursor');
  });

  it('reaches channels beyond the first 200 in one request per page', async () => {
    const ids = Array.from({ length: 405 }, (_, index) => `C${index}`);
    api.list.mockImplementation(async ({ cursor, limit }: { cursor?: string; limit: number }) => {
      const offset = Number(cursor ?? 0);
      return { channels: ids.slice(offset, offset + limit).map((id) => ({ id })),
        response_metadata: { next_cursor: offset + limit < ids.length ? String(offset + limit) : '' } };
    });
    const found: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const result = JSON.parse(JSON.stringify(await new SlackConnector('test').execute('channels.list', { limit: 200, cursor }, context)));
      expect(result.data.truncated).toBe(page < 2);
      found.push(...result.data.channels.map((channel: { id: string }) => channel.id));
      cursor = result.data.nextCursor;
      expect(api.list).toHaveBeenCalledTimes(page + 1);
    }
    expect(found).toEqual(ids);
  });

  it('reaches search matches beyond 50 through explicit pages and provider total', async () => {
    api.search.mockImplementation(async ({ page = 1, count }: { page?: number; count: number }) => ({ messages: {
      matches: Array.from({ length: page < 3 ? count : 3 }, (_, index) => ({ channel: { id: 'C123' }, ts: `${(page - 1) * count + index}.000` })),
      paging: { page, pages: 3, total: 103 },
    } }));
    let nextPage = 1;
    const found: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = JSON.parse(JSON.stringify(await new SlackConnector('test').execute('messages.search', { query: 'invoice', limit: 50, page: nextPage }, context)));
      expect(result.data.truncated).toBe(page < 3);
      expect(result.data.total).toBe(103);
      found.push(...result.data.matches.map((message: { ts: string }) => message.ts));
      nextPage = result.data.nextPage;
      expect(api.search).toHaveBeenCalledTimes(page);
    }
    expect(new Set(found).size).toBe(103);
  });

  it('resumes history after a filtered page without losing older user messages', async () => {
    api.history.mockResolvedValueOnce({ messages: [{ type: 'message', subtype: 'channel_join', ts: '200.000' }], response_metadata: { next_cursor: 'older' } })
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '199.000', text: 'older user message' }] });
    const connector = new SlackConnector('test');
    const first = await connector.execute('messages.read', { channel: 'C123', limit: 1 }, context);
    expect(first).toMatchObject({ ok: true, data: { messages: [], truncated: true, nextCursor: 'older' } });
    expect(api.history).toHaveBeenCalledOnce();
    const second = await connector.execute('messages.read', { channel: 'C123', limit: 1, cursor: 'older' }, context);
    expect(second).toMatchObject({ ok: true, data: { messages: [{ ts: '199.000' }], truncated: false } });
    expect(api.history).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'older' }));
  });

  it('uses provider cursors for search and treats an empty cursor as the end', async () => {
    api.search.mockResolvedValueOnce({ messages: { matches: [], paging: { page: 1, pages: 3, total: 103 } }, response_metadata: { next_cursor: 'tail' } })
      .mockResolvedValueOnce({ messages: { matches: [{ channel: { id: 'C123' }, ts: '1.000' }], paging: { page: 1, pages: 3, total: 103 } }, response_metadata: { next_cursor: '' } });
    const connector = new SlackConnector('test');
    const first = await connector.execute('messages.search', { query: 'test' }, context);
    expect(first).toMatchObject({ ok: true, data: { truncated: true, nextCursor: 'tail' } });
    expect(api.search).toHaveBeenNthCalledWith(1, { query: 'test', count: 20, cursor: '*' });
    const second = await connector.execute('messages.search', { query: 'test', cursor: 'tail' }, context);
    expect(second).toMatchObject({ ok: true, data: { truncated: false } });
    expect(second.data).not.toHaveProperty('nextPage');
  });

  it('reaches older history beyond 50 messages using serialized cursors', async () => {
    const timestamps = Array.from({ length: 105 }, (_, index) => `${200 - index}.000`);
    api.history.mockImplementation(async ({ cursor, limit }: { cursor?: string; limit: number }) => {
      const offset = Number(cursor ?? 0);
      return { messages: timestamps.slice(offset, offset + limit).map((ts) => ({ type: 'message', ts })),
        response_metadata: { next_cursor: offset + limit < timestamps.length ? String(offset + limit) : '' } };
    });
    let cursor: string | undefined;
    const found: string[] = [];
    for (let page = 0; page < 3; page += 1) {
      const result = JSON.parse(JSON.stringify(await new SlackConnector('test').execute('messages.read', { channel: 'C123', limit: 50, cursor }, context)));
      expect(result.data.truncated).toBe(page < 2);
      expect(result.data).not.toHaveProperty('total');
      found.push(...result.data.messages.map((message: { ts: string }) => message.ts));
      cursor = result.data.nextCursor;
      expect(api.history).toHaveBeenCalledTimes(page + 1);
    }
    expect(found).toEqual(timestamps);
  });

  it('round-trips timestamp continuation when Slack only returns has_more', async () => {
    api.history.mockResolvedValueOnce({ messages: [{ type: 'message', ts: '2.000' }], has_more: true })
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '1.000' }], has_more: false });
    const connector = new SlackConnector('test');
    const first = JSON.parse(JSON.stringify(await connector.execute('messages.read', { channel: 'C123', limit: 1 }, context)));
    expect(first.data).toMatchObject({ truncated: true, nextLatest: '2.000' });
    const second = await connector.execute('messages.read', { channel: first.data.channelId, limit: first.data.limit, latest: first.data.nextLatest }, context);
    expect(second).toMatchObject({ ok: true, data: { truncated: false, messages: [{ ts: '1.000' }] } });
    expect(api.history).toHaveBeenNthCalledWith(2, expect.objectContaining({ latest: '2.000' }));
  });

  it.each([
    ['channels.list', { cursor: 3 }],
    ['messages.search', { query: 'test', page: 0 }],
    ['messages.search', { query: 'test', page: 1, cursor: 'other' }],
    ['messages.read', { channel: 'C123', latest: 'invalid' }],
  ])('rejects invalid continuation for %s before network access', async (action, params) => {
    expect(await new SlackConnector('test').execute(action, params, context)).toMatchObject({ ok: false, errorCode: 'invalid_params' });
    expect(api.list).not.toHaveBeenCalled();
    expect(api.search).not.toHaveBeenCalled();
    expect(api.history).not.toHaveBeenCalled();
  });

  it('does not slice overfilled pages and skip their omitted rows', async () => {
    api.list.mockResolvedValue({ channels: [{ id: 'C1' }, { id: 'C2' }], response_metadata: { next_cursor: 'after-both' } });
    expect(await new SlackConnector('test').execute('channels.list', { limit: 1 }, context))
      .toMatchObject({ ok: false, error: 'page_size_exceeded' });
  });

  it('does not present an unsupported page 101 as usable continuation', async () => {
    api.search.mockResolvedValue({ messages: { matches: [], paging: { page: 100, pages: 101, total: 5050 } } });
    const result = await new SlackConnector('test').execute('messages.search', { query: 'test', page: 100, limit: 50 }, context);
    expect(result).toMatchObject({ ok: true, data: { truncated: true, paginationLimitReached: true, total: 5050 } });
    expect(result.data).not.toHaveProperty('nextPage');
  });
});

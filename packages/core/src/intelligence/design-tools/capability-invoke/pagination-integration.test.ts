import { google, type gmail_v1 } from 'googleapis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailConnector } from '../../../connectors/gmail/connector.js';
import { SlackConnector } from '../../../connectors/slack/connector.js';
import { buildDesignToolContext } from '../context.js';
import { executeDesignTool } from '../execute.js';
import type { CapabilityInvokeEnvelope } from '../capability-invoke.js';
import type { DesignToolResult } from '../types.js';

// Replace only SDK requests; the public page helpers, connectors and projections run unchanged.
const slack = vi.hoisted(() => ({ list: vi.fn(), search: vi.fn(), history: vi.fn() }));
vi.mock('@slack/web-api', () => ({ WebClient: class {
  conversations = { list: slack.list, history: slack.history };
  search = { messages: slack.search };
} }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

interface PageData {
  messages?: Array<{ id: string; ts?: string }>;
  channels?: Array<{ id: string }>;
  hits?: Array<{ ref: { id: string } }>;
  limit?: number;
  nextPageToken?: string;
  nextCursor?: string;
  nextPage?: number;
  nextLatest?: string;
  truncated?: boolean;
}

function envelope(result: DesignToolResult): CapabilityInvokeEnvelope & { data: PageData } {
  expect(result.ok).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
  return JSON.parse(JSON.stringify(result.data));
}

function slackContext(allowUntrustedData = false) {
  const connector = new SlackConnector('test-token');
  const ctx = buildDesignToolContext([], ['slack'], { allowUntrustedData, connectors: { slack: connector } });
  return { connector, ctx };
}

describe('public connector pagination through model evidence', () => {
  it('round-trips Gmail nextPageToken through metadata-only reads to the final page', async () => {
    const ids = Array.from({ length: 53 }, (_, index) => `m${index}`);
    const tokens = [undefined, `opaque:${'a'.repeat(3_000)}:25`, `opaque:${'b'.repeat(3_000)}:50`];
    const list = vi.fn(async ({ pageToken, maxResults }: { pageToken?: string; maxResults: number }) => {
      const page = tokens.indexOf(pageToken);
      expect(page).toBeGreaterThanOrEqual(0);
      const offset = page * maxResults;
      return { data: {
        messages: ids.slice(offset, offset + maxResults).map((id) => ({ id, threadId: `t${id}`, body: 'private-body' })),
        nextPageToken: tokens[page + 1], resultSizeEstimate: ids.length,
      } };
    });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const ctx = buildDesignToolContext([], ['gmail'], {
      connectors: { gmail: new GmailConnector({ clientId: 'test-client', refreshToken: 'test-token' }) },
    });
    let pageToken: string | undefined;
    const found: string[] = [];
    for (let page = 0; page < 3; page += 1) {
      const view = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: {
        id: 'gmail.messages.search', params: { query: 'invoice', limit: 25, pageToken },
      } }, ctx));
      expect(view.data).toMatchObject({ limit: 25, total: 53, totalIsEstimate: true, resultSizeEstimate: 53, truncated: page < 2 });
      expect(JSON.stringify(view)).not.toContain('private-body');
      found.push(...view.data.messages!.map((message) => message.id));
      pageToken = view.data.nextPageToken;
      expect(pageToken).toBe(tokens[page + 1]);
    }
    expect(found).toEqual(ids);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('retains the Slack channel cursor after preview clipping and marks the final page correctly', async () => {
    const nextCursor = `opaque:${'c'.repeat(3_000)}:200`;
    slack.list.mockResolvedValueOnce({
      channels: Array.from({ length: 200 }, (_, index) => ({ id: `C${index}`, name: `channel${index}` })),
      response_metadata: { next_cursor: nextCursor },
    }).mockResolvedValueOnce({ channels: [{ id: 'C200', name: 'last' }], response_metadata: { next_cursor: '' } });
    const { connector, ctx } = slackContext();
    const execute = vi.spyOn(connector, 'execute');
    const first = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.channels.list', params: { limit: 200 } } }, ctx));
    expect(first.data).toMatchObject({ limit: 200, nextCursor, truncated: true });
    expect(first.data.channels).toHaveLength(50);
    expect(first.evidence).toMatchObject({ truncated: true, reason: 'model_evidence_limit' });
    expect(((await execute.mock.results[0]!.value).data as { channels: unknown[] }).channels).toHaveLength(200);
    const last = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: {
      id: 'slack.channels.list', params: { limit: first.data.limit, cursor: first.data.nextCursor },
    } }, ctx));
    expect(last.data).toMatchObject({ limit: 200, truncated: false, channels: [{ id: 'C200' }] });
    expect(last.data).not.toHaveProperty('nextCursor');
    expect(slack.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: nextCursor, limit: 200 }));
  });

  it('round-trips numeric Slack search pages and retains the final total', async () => {
    slack.search.mockImplementation(async ({ page, count }: { page: number; count: number }) => ({ messages: {
      matches: Array.from({ length: page < 3 ? count : 3 }, (_, index) => ({
        channel: { id: 'C123' }, ts: `${(page - 1) * count + index}.000`, text: 'snippet',
      })), paging: { page, pages: 3, total: 53 },
    } }));
    const { ctx } = slackContext();
    const found: string[] = [];
    let nextPage: number | undefined = 1;
    for (let page = 1; page <= 3; page += 1) {
      const view = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: {
        id: 'slack.messages.search', params: { query: 'invoice', limit: 25, page: nextPage },
      } }, ctx));
      expect(view.data).toMatchObject({ page, limit: 25, total: 53, truncated: page < 3 });
      expect(view.data).not.toHaveProperty('matches');
      found.push(...view.data.hits!.map((hit) => hit.ref.id));
      nextPage = view.data.nextPage;
      expect(nextPage).toBe(page < 3 ? page + 1 : undefined);
    }
    expect(new Set(found).size).toBe(53);
    expect(slack.search).toHaveBeenNthCalledWith(3, { query: 'invoice', count: 25, page: 3 });
  });

  it('honors an exhausted Slack search cursor even when page-count metadata says more', async () => {
    const nextCursor = `opaque:${'s'.repeat(3_000)}`;
    slack.search.mockResolvedValueOnce({ messages: { matches: [], paging: { page: 1, pages: 3, total: 103 } }, response_metadata: { next_cursor: nextCursor } })
      .mockResolvedValueOnce({ messages: { matches: [], paging: { page: 1, pages: 3, total: 103 } }, response_metadata: { next_cursor: '' } });
    const { ctx } = slackContext();
    const first = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.search', params: { query: 'invoice' } } }, ctx));
    expect(first.data).toMatchObject({ nextCursor, truncated: true });
    const last = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.search', params: { query: 'invoice', cursor: first.data.nextCursor } } }, ctx));
    expect(last.data.truncated).toBe(false);
    expect(last.data).not.toHaveProperty('nextCursor');
    expect(last.data).not.toHaveProperty('nextPage');
    expect(slack.search).toHaveBeenNthCalledWith(2, { query: 'invoice', count: 20, cursor: nextCursor });
  });

  it('retains the Slack pagination-limit marker without inventing a final page or usable next page', async () => {
    slack.search.mockResolvedValue({ messages: { matches: [], paging: { page: 100, pages: 101, total: 5050 } } });
    const { ctx } = slackContext();
    const view = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.search', params: { query: 'invoice', limit: 50, page: 100 } } }, ctx));
    expect(view.data).toMatchObject({ limit: 50, total: 5050, truncated: true, paginationLimitReached: true });
    expect(view.data).not.toHaveProperty('nextPage');
    expect(view.data).not.toHaveProperty('nextCursor');
  });

  it('round-trips Slack history timestamps after clipping body evidence', async () => {
    slack.history.mockResolvedValueOnce({ messages: [{ type: 'message', ts: '200.123456', text: 'x'.repeat(20_000) }], has_more: true })
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '199.123456', text: 'last' }], has_more: false });
    const { ctx } = slackContext(true);
    const first = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.read', params: { channel: 'C123', limit: 1 } } }, ctx));
    expect(first.data).toMatchObject({ limit: 1, nextLatest: '200.123456', truncated: true });
    expect(first.evidence).toMatchObject({ truncated: true, reason: 'model_evidence_limit' });
    const last = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.read', params: { channel: 'C123', limit: first.data.limit, latest: first.data.nextLatest } } }, ctx));
    expect(last.data).toMatchObject({ truncated: false, messages: [{ ts: '199.123456' }] });
    expect(last.data).not.toHaveProperty('nextLatest');
    expect(slack.history).toHaveBeenNthCalledWith(2, expect.objectContaining({ latest: '200.123456', limit: 1 }));
  });

  it('retains a Slack history cursor after an empty filtered page', async () => {
    slack.history.mockResolvedValueOnce({ messages: [{ type: 'message', subtype: 'channel_join', ts: '200.000' }], response_metadata: { next_cursor: 'older' } })
      .mockResolvedValueOnce({ messages: [{ type: 'message', ts: '199.000', text: 'last' }] });
    const { ctx } = slackContext(true);
    const first = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.read', params: { channel: 'C123', limit: 1 } } }, ctx));
    expect(first.data).toMatchObject({ messages: [], nextCursor: 'older', truncated: true });
    const last = envelope(await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.read', params: { channel: 'C123', limit: 1, cursor: first.data.nextCursor } } }, ctx));
    expect(last.data).toMatchObject({ truncated: false, messages: [{ ts: '199.000' }] });
    expect(last.data).not.toHaveProperty('nextCursor');
    expect(slack.history).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'older' }));
  });
});

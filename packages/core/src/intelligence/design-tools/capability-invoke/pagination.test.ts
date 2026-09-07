import { google, type gmail_v1 } from 'googleapis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDesignToolContext } from '../context.js';
import { executeDesignTool } from '../execute.js';
import { boundCapabilityEvidence } from '../capability-invoke.js';
import type { ConnectorContext } from '../../../connectors/types.js';
import { GmailConnector } from '../../../connectors/gmail/connector.js';

afterEach(() => vi.restoreAllMocks());

describe('capability evidence pagination', () => {
  it('keeps Gmail message identifiers through the real connector and metadata-only projection', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [{ id: 'm1', threadId: 't1', body: 'private-body' }] } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const ctx = buildDesignToolContext([], ['gmail'], {
      connectors: { gmail: new GmailConnector({ clientId: 'test-client', refreshToken: 'test-token' }) },
    });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'gmail.messages.search', params: { query: 'invoice', limit: 1 } } }, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"id":"m1"');
    expect(JSON.stringify(result)).not.toContain('private-body');
    expect(list).toHaveBeenCalledOnce();
  });

  it.each([
    ['gmail', 'gmail.messages.search', 'nextPageToken'],
    ['slack', 'slack.channels.list', 'nextCursor'],
  ])('preserves exact %s continuation for a metadata-only caller and forwards it unchanged', async (connector, id, field) => {
    const cursor = `opaque:${'a'.repeat(3_000)}=+/`;
    const data = {
      hits: [{ ref: { id: '1', connector, kind: 'message' }, score: 1, snippet: 'safe' }],
      channels: [{ id: 'C1', name: 'general' }],
      [field]: cursor, truncated: true, total: 200, resultSizeEstimate: 200,
      completeness: { status: 'partial', reason: 'provider_limit', observedCount: 1, hasMore: true },
      matches: [{ body: 'private-body' }], raw: 'private-body',
    };
    const execute = vi.fn(async (_action: string, _params: Record<string, unknown>, _ctx: ConnectorContext) => ({ ok: true, data }));
    const ctx = buildDesignToolContext([], [connector], { connectors: { [connector]: { name: connector, execute } } });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id } }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ data: {
      [field]: cursor, truncated: true, total: 200, resultSizeEstimate: 200,
      completeness: data.completeness,
    } });
    expect(JSON.stringify(result)).not.toContain('private-body');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    const next = (result.data as { data: Record<string, unknown> }).data[field];
    await executeDesignTool({ tool: 'capabilities.invoke', args: { id, params: { [field === 'nextCursor' ? 'cursor' : 'pageToken']: next } } }, ctx);
    expect(execute.mock.calls[1]).toEqual(expect.arrayContaining([{ [field === 'nextCursor' ? 'cursor' : 'pageToken']: cursor }]));
  });

  it.each([true, false])('preserves numeric Slack search paging (allowUntrustedData=%s)', async (allowUntrustedData) => {
    const data = {
      hits: [], matches: [{ text: 'private-body' }],
      nextPage: 3, page: 2, total: 82, truncated: true, hasMore: true,
    };
    const ctx = buildDesignToolContext([], ['slack'], {
      allowUntrustedData,
      connectors: { slack: { name: 'slack', execute: async () => ({ ok: true, data }) } },
    });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.search' } }, ctx);
    expect(result.data).toMatchObject({ data: { nextPage: 3, page: 2, total: 82, truncated: true, hasMore: true } });
  });

  it('preserves page metadata placed after large rows without claiming more upstream pages', () => {
    const data = {
      rows: Array.from({ length: 1_000 }, () => ({ value: 'x'.repeat(2_000) })),
      nextCursor: null, nextPageToken: '', total: 1_000, truncated: false, hasMore: false,
      completeness: { status: 'complete', observedCount: 1_000, hasMore: false },
    };
    const result = boundCapabilityEvidence({ capabilityId: 'http.request', data, citations: [], untrusted: true });
    expect(result.data).toMatchObject({ nextCursor: null, nextPageToken: '', total: 1_000, truncated: false, hasMore: false, completeness: data.completeness });
    expect(result.evidence).toMatchObject({ truncated: true, reason: 'model_evidence_limit' });
    expect(data.rows).toHaveLength(1_000);
  });

  it('reserves exact continuation ahead of row content regardless of field order', () => {
    const cursor = `opaque:${'a'.repeat(3_000)}=+/`;
    const result = boundCapabilityEvidence({
      capabilityId: 'http.request', citations: [], untrusted: true,
      data: { rows: Array.from({ length: 500 }, () => ({ value: 'x'.repeat(2_000) })), nextCursor: cursor, nextPage: 2, hasMore: true,
        limit: 500, totalIsEstimate: false, paginationLimitReached: false },
    });
    expect(result.data).toMatchObject({ nextCursor: cursor, nextPage: 2, hasMore: true,
      limit: 500, totalIsEstimate: false, paginationLimitReached: false });
    expect(result.evidence?.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
  });

  it('fails explicitly instead of returning an unusable shortened oversized cursor', async () => {
    const cursor = 'opaque'.repeat(20_000);
    const ctx = buildDesignToolContext([], ['slack'], {
      connectors: { slack: { name: 'slack', execute: async () => ({ ok: true, data: { channels: [], nextCursor: cursor, hasMore: true } }) } },
    });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.channels.list' } }, ctx);
    expect(result).toMatchObject({ ok: false, error: 'capability_paging_metadata_too_large' });
    expect(JSON.stringify(result)).not.toContain('opaque');
  });

  it('keeps upstream completeness separate from a clipped table preview', () => {
    const completeness = { status: 'complete', observedCount: 1_000, hasMore: false };
    const data = {
      rows: Array.from({ length: 1_000 }, () => ({ value: 'x'.repeat(200) })),
      kind: 'table', truncated: false, completeness,
    };
    const result = boundCapabilityEvidence({ capabilityId: 'rdb.query.read', data, citations: [], untrusted: true });
    expect(result.evidence).toMatchObject({ truncated: true, upstreamCompleteness: completeness });
    expect(result.data).toMatchObject({ truncated: true, completeness: { status: 'partial' } });
    expect((result.data as { completeness: object }).completeness).not.toHaveProperty('hasMore', true);
    expect(data.completeness).toBe(completeness);
  });

  it('accounts for escaped and combined cursor size before preserving paging metadata', () => {
    for (const paging of [{ nextCursor: '\u0000'.repeat(1_500) }, { nextCursor: 'a'.repeat(5_000), nextPageToken: 'b'.repeat(5_000) }]) {
      expect(() => boundCapabilityEvidence({ capabilityId: 'http.request', data: paging, citations: [], untrusted: true }))
        .toThrow('capability_paging_metadata_too_large');
    }
  });

  it('does not mistake a business total string for paging metadata', () => {
    const data = { total: 'KRW 100', rows: [{ id: '1' }] };
    const result = boundCapabilityEvidence({ capabilityId: 'http.request', data, citations: [], untrusted: true });
    expect(result.data).toEqual(data);
    expect(result.evidence?.truncated).toBe(false);
  });

  it('distinguishes a shortened metadata page from privacy-only filtering', async () => {
    const data = {
      channels: Array.from({ length: 200 }, (_, index) => ({ id: `C${index}`, name: 'general' })),
      nextCursor: 'next-provider-page', truncated: true, hasMore: true,
    };
    const ctx = buildDesignToolContext([], ['slack'], {
      connectors: { slack: { name: 'slack', execute: async () => ({ ok: true, data }) } },
    });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.channels.list' } }, ctx);
    expect(result.data).toMatchObject({
      data: { nextCursor: 'next-provider-page', hasMore: true },
      evidence: { truncated: true, reason: 'model_evidence_limit' },
    });
  });

  it('does not label omitted optional JSON fields as missing page evidence', () => {
    const result = boundCapabilityEvidence({
      capabilityId: 'slack.channels.list', citations: [], untrusted: true,
      data: { channels: [{ id: 'C1', name: undefined }], hasMore: false, truncated: false },
    });
    expect(result.evidence?.truncated).toBe(false);
  });
});

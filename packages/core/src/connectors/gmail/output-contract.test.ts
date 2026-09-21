import { google, type gmail_v1 } from 'googleapis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCapability } from '../../catalog/capabilities.js';
import { materializeStepOutputs } from '../../runtime/output-ports.js';
import { GmailConnector } from './connector.js';

afterEach(() => vi.restoreAllMocks());

describe('Gmail public page output contracts', () => {
  it.each(['first', 'last', 'empty'])('materializes the %s page with the registered capability IO', async (page) => {
    const messages = page === 'empty' ? [] : [{ id: 'mail-1', threadId: 'thread-1' }];
    const list = vi.fn().mockResolvedValue({ data: {
      messages, ...(page === 'first' ? { nextPageToken: 'next-mail-page', resultSizeEstimate: 23 } : {}),
    } });
    const get = vi.fn().mockResolvedValue({ data: { payload: { headers: [] } } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list, get } } } as unknown as gmail_v1.Gmail);
    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {
      ...(page === 'first' ? {} : { pageToken: 'requested-page' }),
    }, {
      executionId: 'outputs', variables: {}, log: () => undefined,
    });
    expect(result.ok).toBe(true);
    const original = structuredClone(result.data);
    const contracts = getCapability('gmail.messages.search')!.io!.outputs;
    const outputs = materializeStepOutputs('gmail-search', contracts, result.data);
    expect(Object.keys(outputs)).toEqual(Object.keys(contracts));
    for (const port of Object.keys(contracts)) expect(result.data).toHaveProperty(port);
    expect(outputs.messages).toMatchObject({ kind: 'table', rows: expect.any(Array) });
    expect(outputs.messages).toMatchObject({ completeness: { status: 'partial', hasMore: page === 'first' } });
    expect(outputs.truncated).toEqual({ value: page === 'first' });
    expect(result.data).toEqual(original);
    if (page === 'first') {
      expect(result.data).toMatchObject({ nextPageToken: 'next-mail-page', total: 23, totalIsEstimate: true });
    } else {
      for (const key of ['nextPageToken', 'resultSizeEstimate', 'total', 'totalIsEstimate']) {
        expect(result.data).not.toHaveProperty(key);
      }
    }
  });

  it('materializes a complete initial response with no continuation as complete', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [] } });
    const get = vi.fn().mockResolvedValue({ data: { payload: { headers: [] } } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list, get } } } as unknown as gmail_v1.Gmail);
    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {}, {
      executionId: 'outputs', variables: {}, log: () => undefined,
    });
    const outputs = materializeStepOutputs('gmail-search', getCapability('gmail.messages.search')!.io!.outputs, result.data);
    expect(outputs.messages).toMatchObject({ completeness: { status: 'complete', hasMore: false } });
  });

  it('returns metadata headers without reading message bodies', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [{ id: 'mail-1', threadId: 'thread-1' }] } });
    const get = vi.fn().mockResolvedValue({ data: {
      id: 'mail-1',
      payload: { headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'Subject', value: '재고 보고서' },
        { name: 'Date', value: 'Sat, 20 Sep 2026 09:00:00 +0900' },
      ] },
    } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list, get } } } as unknown as gmail_v1.Gmail);

    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {
      limit: 1,
      includeMetadata: true,
    }, {
      executionId: 'metadata', variables: {}, log: () => undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { messages: [{ id: 'mail-1', from: 'sender@example.com', subject: '재고 보고서', date: 'Sat, 20 Sep 2026 09:00:00 +0900' }] },
    });
    expect(get).toHaveBeenCalledWith({
      userId: 'me',
      id: 'mail-1',
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    expect(get.mock.calls[0]?.[0]).not.toHaveProperty('format', 'full');
  });

  it('does not enrich when a model sends includeMetadata=false as a string', async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [{ id: 'mail-1', threadId: 'thread-1' }] } });
    const get = vi.fn();
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list, get } } } as unknown as gmail_v1.Gmail);

    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {
      limit: 1,
      includeMetadata: 'false',
    }, {
      executionId: 'metadata-disabled', variables: {}, log: () => undefined,
    });

    expect(result).toMatchObject({ ok: true, data: { messages: [{ id: 'mail-1' }] } });
    expect(get).not.toHaveBeenCalled();
  });

  it('bounds metadata enrichment concurrency for a full provider page', async () => {
    let active = 0;
    let peak = 0;
    const list = vi.fn().mockResolvedValue({ data: {
      messages: Array.from({ length: 50 }, (_, index) => ({ id: `mail-${index}` })),
    } });
    const get = vi.fn().mockImplementation(async ({ id }: { id: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { data: { id, payload: { headers: [] } } };
    });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list, get } } } as unknown as gmail_v1.Gmail);

    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {
      limit: 50,
      includeMetadata: true,
    }, {
      executionId: 'metadata-bounded', variables: {}, log: () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(get).toHaveBeenCalledTimes(50);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('keeps a list row when the message disappears during metadata enrichment', async () => {
    const list = vi.fn().mockResolvedValue({ data: {
      messages: [{ id: 'mail-missing' }, { id: 'mail-present' }],
    } });
    const get = vi.fn()
      .mockRejectedValueOnce({ code: 404 })
      .mockResolvedValueOnce({ data: { id: 'mail-present', payload: { headers: [
        { name: 'Subject', value: '남은 메일' },
      ] } } });
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list, get } } } as unknown as gmail_v1.Gmail);

    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {
      limit: 2,
      includeMetadata: true,
    }, {
      executionId: 'metadata-race', variables: {}, log: () => undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { messages: [
        { id: 'mail-missing' },
        { id: 'mail-present', subject: '남은 메일' },
      ] },
    });
  });
});

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
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
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
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } } as unknown as gmail_v1.Gmail);
    const result = await new GmailConnector({ clientId: 'test', refreshToken: 'test' }).execute('messages.search', {}, {
      executionId: 'outputs', variables: {}, log: () => undefined,
    });
    const outputs = materializeStepOutputs('gmail-search', getCapability('gmail.messages.search')!.io!.outputs, result.data);
    expect(outputs.messages).toMatchObject({ completeness: { status: 'complete', hasMore: false } });
  });
});

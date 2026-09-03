import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../../../connector.js';
describe('HTTP read truncation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('caps the error body preview and marks it truncated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(4_001), { status: 500, statusText: 'Internal Server Error' })));
    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute('request', { method: 'GET', path: 'broken' }, { executionId: 'e1', variables: {}, log: vi.fn() });
    expect(result).toMatchObject({
      ok: false,
      error: 'http_500',
      errorDetails: { status: 500, statusText: 'Internal Server Error', body: 'x'.repeat(4_000), truncated: true },
    });
  });
});

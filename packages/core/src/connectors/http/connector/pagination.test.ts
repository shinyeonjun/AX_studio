import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../connector.js';

afterEach(() => vi.unstubAllGlobals());
const context = () => ({ executionId: 'pages', variables: {}, log: vi.fn() });

/** A provider with `total` items served 30 at a time from `skip`. */
function stubOffsetProvider(total: number) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const skip = Number(new URL(String(url)).searchParams.get('skip') ?? 0);
    const products = Array.from({ length: Math.max(0, Math.min(30, total - skip)) }, (_, index) => ({ id: skip + index + 1 }));
    return new Response(JSON.stringify({ products, total, skip, limit: 30 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('an HTTP read registered as every page', () => {
  const connector = () => new HttpConnector({ baseUrl: 'http://127.0.0.1:10001/' }, { allowPrivateNetwork: true });

  it('follows the provider envelope and returns every row in one response', async () => {
    const fetchMock = stubOffsetProvider(194);
    const result = await connector().execute('request', { path: 'products?select=title', allPages: true }, context());
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://127.0.0.1:10001/products?select=title&skip=30');
    const data = (result as { ok: true; data: { body: string; completeness: unknown } }).data;
    expect((JSON.parse(data.body) as { products: unknown[] }).products).toHaveLength(194);
    expect(data.completeness).toMatchObject({ status: 'complete', hasMore: false });
  });

  it('reads one page unless asked, and says when the limit cut the set short', async () => {
    const fetchMock = stubOffsetProvider(5_000);
    await connector().execute('request', { path: 'products' }, context());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const result = await connector().execute('request', { path: 'products', allPages: true }, context());
    expect(result).toMatchObject({ ok: true, data: { completeness: { status: 'partial', reason: 'provider_limit', hasMore: true } } });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../connector.js';

afterEach(() => vi.unstubAllGlobals());
const context = () => ({ executionId: 'hardening', variables: {}, log: vi.fn() });

describe('HTTP exact selection and completeness', () => {
  it('prefers the exact endpoint ID over another endpoint label', async () => {
    const fetchMock = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = new HttpConnector([
      { id: 'other', label: 'selected', baseUrl: 'http://127.0.0.1:10001/' },
      { id: 'selected', baseUrl: 'http://127.0.0.1:10002/' },
    ]);
    expect((await connector.execute('request', { connectionId: 'selected', path: '/' }, context())).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:10002/', expect.anything());
  });

  it('rejects an ambiguous label before sending a request', async () => {
    const fetchMock = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = new HttpConnector([
      { id: 'one', label: 'same', baseUrl: 'http://127.0.0.1:10001/' },
      { id: 'two', label: 'same', baseUrl: 'http://127.0.0.1:10002/' },
    ]);
    expect(await connector.execute('request', { connectionId: 'same', path: '/' }, context()))
      .toMatchObject({ ok: false, errorCode: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 206, headers: { 'content-range': 'bytes 0-1/10' } },
    { status: 200, headers: { link: '</items?page=2>; rel="next"' } },
    { status: 200, headers: { link: '</items?page=2>; rel="next last"' } },
  ])('marks provider partial results as incomplete: %j', async ({ status, headers }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status, headers })));
    const connector = new HttpConnector({ baseUrl: 'http://127.0.0.1:10001/' });
    expect(await connector.execute('request', { path: '/items' }, context())).toMatchObject({
      ok: true, data: { body: '[]', truncated: status === 206, completeness: { status: 'partial', reason: 'provider_limit', hasMore: true } },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not confuse a link title with a next relation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', {
      headers: { link: '</docs>; title="rel=next, previous"; rel="help"' },
    })));
    const connector = new HttpConnector({ baseUrl: 'http://127.0.0.1:10001/' });
    expect(await connector.execute('request', { path: '/items' }, context())).toMatchObject({
      ok: true, data: { truncated: false, completeness: { status: 'complete' } },
    });
  });
});

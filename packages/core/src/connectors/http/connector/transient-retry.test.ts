import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../connector.js';

afterEach(() => vi.unstubAllGlobals());
const context = () => ({ executionId: 'retry', variables: {}, log: vi.fn() });
const connector = () => new HttpConnector({ baseUrl: 'http://127.0.0.1:10001/' }, { allowPrivateNetwork: true });

describe('a read that meets a passing fault', () => {
  it('asks once more when a gateway was briefly busy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('[1]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await connector().execute('request', { path: '/items' }, context())).toMatchObject({ ok: true, data: { body: '[1]' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not ask again for an answer that will not change', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await connector().execute('request', { path: '/items' }, context())).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the second try', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await connector().execute('request', { path: '/items' }, context())).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

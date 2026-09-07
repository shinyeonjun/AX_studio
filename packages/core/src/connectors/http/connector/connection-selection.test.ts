import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpConnector } from '../connector.js';

describe('HttpConnector connection selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends GET to the HTTP connection saved on the step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200, statusText: 'OK' })),
    );

    const connector = new HttpConnector([
      { id: 'default', baseUrl: 'https://api.github.com/' },
      { id: 'tickets', baseUrl: 'https://api.example.com/v1/' },
    ]);
    const result = await connector.execute(
      'request',
      { method: 'GET', path: '/tickets', connectionId: 'tickets' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/tickets',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('requires an explicit connection when multiple endpoints are configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connector = new HttpConnector([
      { id: 'github', baseUrl: 'https://api.github.com/' },
      { id: 'test', baseUrl: 'http://127.0.0.1:4820/' },
    ]);

    const result = await connector.execute(
      'request',
      { method: 'GET', path: '/api/v1/orders' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result).toEqual({ ok: false, error: 'http_connection_required', errorCode: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps GET inside the saved connection when connectionId is omitted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const connector = new HttpConnector({ baseUrl: 'https://api.github.com/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: '/repos/shinyeonjun/AX_studio/commits' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/shinyeonjun/AX_studio/commits',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

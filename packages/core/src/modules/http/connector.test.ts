import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpConnector } from './connector.js';

describe('HttpConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executes GET within base URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('{"ok":true}', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: 'users' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ status: 200, body: '{"ok":true}' });
    }
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/users',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('returns failure for HTTP 4xx/5xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400, statusText: 'Bad Request' })),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: 'users' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('http_error');
      expect(result.error).toBe('http_400');
    }
  });

  it('executes the explicit POST action with a JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('{"created":true}', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'post',
      { path: 'tickets', body: { title: '검증', priority: 'critical' } },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ status: 201, body: '{"created":true}' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/tickets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: '검증', priority: 'critical' }),
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('does not allow a method override on the explicit POST action', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'post',
      { method: 'DELETE', path: 'tickets', body: '{}' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result).toEqual({ ok: false, error: 'http_post_method_fixed', errorCode: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects paths that escape the base prefix', async () => {
    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: '../../v2/users' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('ssrf_blocked');
    }
  });
});

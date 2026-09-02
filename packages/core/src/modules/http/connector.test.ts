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

  it('preserves bounded response details for HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({ error: 'unauthorized', hint: 'configure the documented lab credential' }),
        {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'application/json' },
        },
      )),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: 'secure/profile' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'http_401',
      errorCode: 'http_error',
      errorDetails: {
        status: 401,
        statusText: 'Unauthorized',
        body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
        truncated: false,
      },
    });
  });

  it('caps the error body preview and marks it truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(4_001), { status: 500, statusText: 'Internal Server Error' })),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: 'broken' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'http_500',
      errorDetails: {
        status: 500,
        statusText: 'Internal Server Error',
        body: 'x'.repeat(4_000),
        truncated: true,
      },
    });
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

  it('does not allow write methods through the read-only request action', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = await connector.execute(
        'request',
        { method, path: 'tickets' },
        { executionId: 'e1', variables: {}, log: vi.fn() },
      );

      expect(result).toEqual({
        ok: false,
        error: 'http_request_method_read_only',
        errorCode: 'invalid_params',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
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

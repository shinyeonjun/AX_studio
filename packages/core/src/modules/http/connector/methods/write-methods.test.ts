import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpConnector } from '../../connector.js';

describe('HttpConnector write method policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});

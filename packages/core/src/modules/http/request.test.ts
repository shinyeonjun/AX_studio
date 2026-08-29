import { describe, expect, it, vi, afterEach } from 'vitest';
import { HTTP_DEFAULT_TIMEOUT_MS, performHttpRequest } from './request.js';

describe('performHttpRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams response bodies without loading more than maxBytes into memory', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('a'.repeat(1024)));
        controller.enqueue(encoder.encode('b'.repeat(1024)));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200, statusText: 'OK' })),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      maxBytes: 1200,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.length).toBeLessThanOrEqual(1200);
      expect(result.truncated).toBe(true);
    }
  });

  it('rejects oversized content-length before reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('huge', {
            status: 200,
            headers: { 'content-length': '99999999' },
          }),
      ),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      maxBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe('');
      expect(result.truncated).toBe(true);
    }
  });

  it('keeps the streamed truncation result when reader cancellation fails', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('oversized'));
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      maxBytes: 4,
    });

    expect(result).toMatchObject({ ok: true, body: 'over', truncated: true });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels redirect response bodies when rejecting the redirect', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 302, headers: { location: 'https://example.com' } })),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
    });

    expect(result).toEqual({
      ok: false,
      error: 'redirect_not_allowed',
      errorCode: 'ssrf_blocked',
      status: 302,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps redirect rejection stable when body cancellation fails', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 302, headers: { location: 'https://example.com' } })),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
    });

    expect(result).toEqual({
      ok: false,
      error: 'redirect_not_allowed',
      errorCode: 'ssrf_blocked',
      status: 302,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels unused HEAD response bodies', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'HEAD',
    });

    expect(result).toMatchObject({ ok: true, body: '', truncated: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps HEAD results stable when body cancellation fails', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'HEAD',
    });

    expect(result).toMatchObject({ ok: true, body: '', truncated: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not return a partial UTF-8 character when truncating a response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('가나', { status: 200 })),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      maxBytes: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      body: '가',
      truncated: true,
    });
  });

  it('does not let request headers override configured bearer authentication', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: { authorization: 'Bearer workflow-value', 'x-request-id': 'request-1' },
      auth: { type: 'bearer', token: 'stored-secret' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({
        headers: { Authorization: 'Bearer stored-secret', 'x-request-id': 'request-1' },
      }),
    );
  });

  it.each([
    { timeoutMs: 0, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: -1, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: Number.NaN, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: Number.POSITIVE_INFINITY, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: 250, expected: 250 },
  ])(
    'normalizes timeoutMs $timeoutMs to $expected',
    async ({ timeoutMs, expected }) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await performHttpRequest({
        url: 'https://api.example.com/data',
        method: 'GET',
        timeoutMs,
      });

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expected);
    },
  );

  it('protects a configured API key header case-insensitively', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: { 'x-api-key': 'workflow-value' },
      auth: { type: 'apiKey', header: 'X-API-Key', token: 'stored-secret' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ headers: { 'X-API-Key': 'stored-secret' } }),
    );
  });
});

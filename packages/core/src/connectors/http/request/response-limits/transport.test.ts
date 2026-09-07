import { performHttpRequest } from '../../request.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performHttpRequest transport response cleanup', () => {
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
});

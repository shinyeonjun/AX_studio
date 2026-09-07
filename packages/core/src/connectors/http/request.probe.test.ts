import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeHttpBaseUrl, probeHttpBaseUrl } from './request.js';

describe('normalizeHttpBaseUrl', () => {
  it('adds https when the scheme is omitted', () => {
    expect(normalizeHttpBaseUrl('api.example.com/v1/')).toEqual({
      ok: true,
      value: 'https://api.example.com/v1/',
    });
  });

  it('rejects unsupported protocols', () => {
    expect(normalizeHttpBaseUrl('ftp://files.example.com/')).toEqual({
      ok: false,
      error: 'unsupported_protocol',
    });
  });
});

describe('probeHttpBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a 404 response as reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' })),
    );

    const probe = await probeHttpBaseUrl('https://api.example.com/v1/');
    expect(probe).toEqual({ ok: true, status: 404 });
  });

  it('accepts 401 responses as reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401, statusText: 'Unauthorized' })),
    );

    const probe = await probeHttpBaseUrl('https://api.example.com/v1/');
    expect(probe).toEqual({ ok: true, status: 401 });
  });

  it('falls back to GET when HEAD fails at the network layer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'HEAD') {
          throw new Error('fetch failed');
        }
        return new Response('ok', { status: 200, statusText: 'OK' });
      }),
    );

    const probe = await probeHttpBaseUrl('https://api.example.com/v1/');
    expect(probe).toEqual({ ok: true, status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })),
    );

    const probe = await probeHttpBaseUrl('https://api.example.com/v1/');
    expect(probe).toEqual({ ok: false, error: 'redirect_not_allowed' });
  });
});

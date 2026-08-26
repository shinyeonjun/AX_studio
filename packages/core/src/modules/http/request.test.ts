import { describe, expect, it, vi, afterEach } from 'vitest';
import { performHttpRequest } from './request.js';

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
});

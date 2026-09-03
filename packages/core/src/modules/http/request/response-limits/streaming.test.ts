import { performHttpRequest } from '../../request.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performHttpRequest streamed response limits', () => {
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
});

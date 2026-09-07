import { performHttpRequest } from '../../request.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performHttpRequest truncation safety', () => {
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

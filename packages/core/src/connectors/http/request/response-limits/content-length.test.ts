import { performHttpRequest } from '../../request.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performHttpRequest content-length preflight', () => {
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
});

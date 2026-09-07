import { performHttpRequest } from '../../request.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performHttpRequest default response limit', () => {
  it.each([-1, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])(
    'keeps the default response limit when maxBytes is %s',
    async (maxBytes) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('huge', {
              status: 200,
              headers: { 'content-length': String(1_048_577) },
            }),
        ),
      );

      const result = await performHttpRequest({
        url: 'https://api.example.com/data',
        method: 'GET',
        maxBytes,
      });

      expect(result).toMatchObject({ ok: true, body: '', truncated: true });
    },
  );
});

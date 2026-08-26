import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './fetch-timeout.js';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves caller cancellation', async () => {
    const caller = new AbortController();
    const reason = new Error('cancelled by caller');
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      return new Response();
    }));

    const request = fetchWithTimeout('https://example.com', { signal: caller.signal });
    caller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });

  it('reports its own deadline as a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      return new Response();
    }));

    const request = fetchWithTimeout('https://example.com', {}, 1_000);
    const assertion = expect(request).rejects.toThrow('요청 시간이 초과되었습니다 (1초).');
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });
});

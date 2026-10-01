import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTextWithTimeout } from './fetch-timeout.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('fetch body resource cleanup', () => {
  it('returns the reader lock after each of 80 successful bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic body')));
    for (let index = 0; index < 80; index++) {
      const { response, text } = await fetchTextWithTimeout('https://fixture.invalid');
      expect(text).toBe('synthetic body');
      expect(response.body?.locked).toBe(false);
    }
  });

  it('returns the reader lock when rejecting an oversized body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '1048577' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(fetchTextWithTimeout('https://fixture.invalid')).rejects.toThrow('응답 본문이 너무 큽니다.');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it('returns the reader lock and clears its timer on cancellation', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const request = fetchTextWithTimeout('https://fixture.invalid', {}, 25);
    const assertion = expect(request).rejects.toThrow('요청 시간이 초과되었습니다');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

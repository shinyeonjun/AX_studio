import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyAnthropicApiKey } from './ai/api-verify.js';
import { fetchTextWithTimeout, fetchWithTimeout } from './fetch-timeout.js';

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

  it('preserves caller cancellation when the timeout fires before fetch rejects', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new Error('cancelled by caller');
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          setTimeout(() => reject(init.signal?.reason), 1_000);
        }, { once: true });
      });
      return new Response();
    }));

    const request = fetchWithTimeout('https://example.com', { signal: caller.signal }, 500);
    const assertion = expect(request).rejects.toBe(reason);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
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

  it('keeps the deadline active while consuming a slow response body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('late body'));
          controller.close();
        }, 2_000);
      },
    }), { status: 500 })));

    const request = fetchTextWithTimeout('https://example.com', {}, 1_000);
    const assertion = expect(request).rejects.toThrow('요청 시간이 초과되었습니다 (1초).');
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('rejects oversized response bodies before returning them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      headers: { 'content-length': '1048577' },
    })));

    await expect(fetchTextWithTimeout('https://example.com')).rejects.toThrow('응답 본문이 너무 큽니다.');
  });

  it('cancels the unread body when Content-Length exceeds the limit', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '1048577' },
    })));
    await expect(fetchTextWithTimeout('https://example.com')).rejects.toThrow('응답 본문이 너무 큽니다.');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('checks Anthropic key authentication through the models endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/models');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ 'x-api-key': 'test-key' });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyAnthropicApiKey('test-key')).resolves.toEqual({
      ok: true,
      label: 'Anthropic API 키 인증됨',
    });
  });

  it('distinguishes Anthropic authentication failures from rate limits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('limited', { status: 429 })));
    await expect(verifyAnthropicApiKey('test-key')).rejects.toThrow('요청 한도를 초과했습니다');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    await expect(verifyAnthropicApiKey('test-key')).rejects.toThrow('API 키가 유효하지 않습니다');
  });
});

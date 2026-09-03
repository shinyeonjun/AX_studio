import { HTTP_DEFAULT_TIMEOUT_MS, performHttpRequest } from '../request.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performHttpRequest request options', () => {
  it('does not let request headers override configured bearer authentication', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: { authorization: 'Bearer workflow-value', 'x-request-id': 'request-1' },
      auth: { type: 'bearer', token: 'stored-secret' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({
        headers: { Authorization: 'Bearer stored-secret', 'x-request-id': 'request-1' },
      }),
    );
  });

  it.each([
    { timeoutMs: 0, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: -1, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: Number.NaN, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: Number.POSITIVE_INFINITY, expected: HTTP_DEFAULT_TIMEOUT_MS },
    { timeoutMs: 250, expected: 250 },
  ])(
    'normalizes timeoutMs $timeoutMs to $expected',
    async ({ timeoutMs, expected }) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await performHttpRequest({
        url: 'https://api.example.com/data',
        method: 'GET',
        timeoutMs,
      });

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expected);
    },
  );

  it('protects a configured API key header case-insensitively', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: { 'x-api-key': 'workflow-value' },
      auth: { type: 'apiKey', header: 'X-API-Key', token: 'stored-secret' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ headers: { 'X-API-Key': 'stored-secret' } }),
    );
  });
});

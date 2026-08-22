import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpConnector } from './connector.js';

describe('HttpConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executes GET within base URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('{"ok":true}', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: 'users' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ status: 200, body: '{"ok":true}' });
    }
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/users',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('rejects paths that escape the base prefix', async () => {
    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute(
      'request',
      { method: 'GET', path: '../../v2/users' },
      { executionId: 'e1', variables: {}, log: vi.fn() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('ssrf_blocked');
    }
  });
});

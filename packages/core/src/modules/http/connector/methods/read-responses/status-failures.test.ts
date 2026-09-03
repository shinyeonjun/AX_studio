import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../../../connector.js';
describe('HTTP read status failures', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns failure for HTTP 4xx/5xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400, statusText: 'Bad Request' })));
    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute('request', { method: 'GET', path: 'users' }, { executionId: 'e1', variables: {}, log: vi.fn() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('http_error');
      expect(result.error).toBe('http_400');
    }
  });
});

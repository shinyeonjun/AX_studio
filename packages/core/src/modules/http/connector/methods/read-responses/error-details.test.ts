import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../../../connector.js';
describe('HTTP read bounded error details', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('preserves bounded response details for HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized', hint: 'configure the documented lab credential' }), { status: 401, statusText: 'Unauthorized', headers: { 'content-type': 'application/json' } })));
    const connector = new HttpConnector({ baseUrl: 'https://api.example.com/v1/' });
    const result = await connector.execute('request', { method: 'GET', path: 'secure/profile' }, { executionId: 'e1', variables: {}, log: vi.fn() });
    expect(result).toMatchObject({
      ok: false,
      error: 'http_401',
      errorCode: 'http_error',
      errorDetails: { status: 401, statusText: 'Unauthorized', body: '{"error":"unauthorized","hint":"configure the documented lab credential"}', truncated: false },
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { buildDesignToolContext } from '../context.js';
import { executeDesignTool } from '../execute.js';
import { HttpConnector } from '../../modules/http/connector.js';

describe('capability invoke HTTP error projection and privacy', () => {
  it('preserves the exact HTTP status and bounded error details at the design-tool boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'unauthorized', hint: 'configure the documented lab credential' }),
      { status: 401, statusText: 'Unauthorized', headers: { 'content-type': 'application/json' } },
    )));

    const ctx = buildDesignToolContext([{ connector: 'http', connected: true }], ['http'], {
      allowUntrustedData: true,
      connectors: { http: new HttpConnector({ baseUrl: 'https://api.example.com/' }) },
    });
    const result = await executeDesignTool({
      tool: 'capabilities.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, ctx);

    expect(result).toMatchObject({
      tool: 'capabilities.invoke',
      ok: false,
      error: 'http_401',
      errorDetails: {
        status: 401,
        statusText: 'Unauthorized',
        body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
        truncated: false,
      },
    });
  });

  it('does not expose provider error details when untrusted data is denied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'unauthorized', hint: 'do not leak this to the cloud caller' }),
      { status: 401, statusText: 'Unauthorized', headers: { 'content-type': 'application/json' } },
    )));

    const ctx = buildDesignToolContext([{ connector: 'http', connected: true }], ['http'], {
      connectors: { http: new HttpConnector({ baseUrl: 'https://api.example.com/' }) },
    });
    const result = await executeDesignTool({
      tool: 'capabilities.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, ctx);

    expect(result).toEqual({ tool: 'capabilities.invoke', ok: false, error: 'http_401' });
  });
});

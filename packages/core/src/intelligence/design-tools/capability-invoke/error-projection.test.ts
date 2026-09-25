import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDesignToolContext } from '../context.js';
import { executeDesignTool } from '../execute.js';
import { connectorFailureKind } from '../capability-invoke.js';
import { HttpConnector } from '../../../connectors/http/connector.js';

afterEach(() => vi.unstubAllGlobals());

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
      failureKind: 'permission_denied',
      errorDetails: {
        status: 401,
        statusText: 'Unauthorized',
        body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
        truncated: false,
      },
    });
  });

  it.each([
    ['http_error_status', { status: 503 }, 'transient'],
    ['http_error_status', { status: 401 }, 'permission_denied'],
    ['ssrf_blocked', undefined, 'host_policy'],
    ['invalid_params', undefined, 'invalid_request'],
    ['slack_channel_not_found', undefined, 'not_found'],
    ['rdb_error', undefined, 'provider_error'],
  ] as const)('classifies %s into a provider-independent category', (code, details, expected) => {
    expect(connectorFailureKind(code, details)).toBe(expected);
  });

  it('blocks raw HTTP reads before fetching when untrusted data is denied', async () => {
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

    expect(result).toEqual({ tool: 'capabilities.invoke', ok: false, error: 'source_content_requires_local_ai' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds generic connector errors and marks shortened provider details', async () => {
    const details = { body: 'x'.repeat(100_000), truncated: false };
    const ctx = buildDesignToolContext([], ['http'], {
      allowUntrustedData: true,
      connectors: { http: { name: 'http', execute: async () => ({ ok: false, error: 'x'.repeat(100_000), errorDetails: details }) } },
    });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'http.request' } }, ctx);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(result.errorDetails).toMatchObject({ truncated: true });
    expect(details.truncated).toBe(false);
    expect(details.body).toHaveLength(100_000);
  });

  it.each(['returned', 'thrown'])('does not disclose %s connector failure text to a metadata-only caller', async (mode) => {
    const ctx = buildDesignToolContext([], ['slack'], {
      connectors: { slack: { name: 'slack', execute: async () => {
        if (mode === 'thrown') throw new Error('private-response in provider failure');
        return { ok: false, error: 'private-response in provider failure', errorDetails: { body: 'private-response' } };
      } } },
    });
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.search' } }, ctx);
    expect(result).toMatchObject({ ok: false, error: 'capability_invoke_failed' });
    expect(JSON.stringify(result)).not.toContain('private-response');
  });
});

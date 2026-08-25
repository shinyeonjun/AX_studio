import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import type { HttpConnectionConfig } from './connection.js';
import { isSupportedHttpMethod } from './connection.js';
import { performHttpRequest } from './request.js';
import { resolveHttpRequestUrl } from './url-security.js';

export class HttpConnector implements Connector {
  name = 'http';

  constructor(private readonly config: HttpConnectionConfig) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action !== 'request' && action !== 'post') {
      return { ok: false, error: `Unknown http action: ${action}`, errorCode: 'unknown_action' };
    }

    if (action === 'post' && params.method !== undefined) {
      if (typeof params.method !== 'string' || params.method.trim().toUpperCase() !== 'POST') {
        return { ok: false, error: 'http_post_method_fixed', errorCode: 'invalid_params' };
      }
    }

    const method = action === 'post'
      ? 'POST'
      : typeof params.method === 'string' && params.method.trim()
        ? params.method.trim().toUpperCase()
        : 'GET';
    if (!isSupportedHttpMethod(method)) {
      return { ok: false, error: 'unsupported_method', errorCode: 'invalid_params' };
    }

    const path = typeof params.path === 'string' ? params.path : '';
    const resolved = resolveHttpRequestUrl(this.config.baseUrl, path);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
    }

    const headers =
      params.headers && typeof params.headers === 'object' && !Array.isArray(params.headers)
        ? Object.fromEntries(
            Object.entries(params.headers as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
            ),
          )
        : undefined;

    const serializedBody = serializeBody(params.body);
    if (!serializedBody.ok) return serializedBody;

    const requestHeaders = serializedBody.json
      ? withJsonContentType(headers)
      : headers;
    const result = await performHttpRequest({
      url: resolved.value.url,
      method,
      headers: requestHeaders,
      body: serializedBody.body,
      auth: this.config.auth,
    });

    if (!result.ok) {
      ctx.log({
        at: new Date().toISOString(),
        level: 'error',
        message: 'http.request_failed',
        data: { method, path, error: result.error, status: result.status },
      });
      return { ok: false, error: result.error, errorCode: result.errorCode };
    }

    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'http.request',
      data: { method, path, status: result.status, truncated: result.truncated },
    });

    if (result.status >= 400) {
      ctx.log({
        at: new Date().toISOString(),
        level: 'error',
        message: 'http.request_failed',
        data: { method, path, status: result.status, truncated: result.truncated },
      });
      return {
        ok: false,
        error: `http_${result.status}`,
        errorCode: 'http_error',
      };
    }

    return {
      ok: true,
      data: {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
        truncated: result.truncated,
        url: resolved.value.url,
      },
    };
  }
}

function serializeBody(value: unknown):
  | { ok: true; body?: string; json: boolean }
  | { ok: false; error: string; errorCode: 'invalid_params' } {
  if (value == null) return { ok: true, body: undefined, json: false };
  if (typeof value === 'string') return { ok: true, body: value, json: false };

  try {
    const body = JSON.stringify(value);
    if (body === undefined) return { ok: false, error: 'http_body_not_serializable', errorCode: 'invalid_params' };
    return { ok: true, body, json: true };
  } catch {
    return { ok: false, error: 'http_body_not_serializable', errorCode: 'invalid_params' };
  }
}

function withJsonContentType(headers: Record<string, string> | undefined): Record<string, string> {
  if (Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'content-type')) return headers ?? {};
  return { ...(headers ?? {}), 'content-type': 'application/json' };
}

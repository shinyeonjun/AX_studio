import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import type { HttpConnectionConfig } from './connection.js';
import { isSupportedHttpMethod } from './connection.js';
import { performHttpRequest } from './request.js';
import { resolveHttpRequestUrl } from './url-security.js';

export class HttpConnector implements Connector {
  name = 'http';

  constructor(private readonly config: HttpConnectionConfig) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action !== 'request') {
      return { ok: false, error: `Unknown http action: ${action}`, errorCode: 'unknown_action' };
    }

    const method = typeof params.method === 'string' && params.method.trim() ? params.method.trim().toUpperCase() : 'GET';
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

    const body = typeof params.body === 'string' ? params.body : undefined;
    const result = await performHttpRequest({
      url: resolved.value.url,
      method,
      headers,
      body,
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

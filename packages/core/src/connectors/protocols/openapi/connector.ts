import type { Connector, ConnectorContext, ConnectorResult } from '../../types.js';
import { performHttpRequest } from '../../http/request.js';
import {
  normalizeHttpHeaders,
  serializeHttpBody,
  withJsonContentType,
} from '../../http/connector/payload.js';
import type { OpenApiSpec } from './parse.js';

function substitutePath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = scalar(params[key]);
    return value !== undefined
      ? encodeURIComponent(value)
      : `{${key}}`;
  });
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
}

function recordParam(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  const key = Object.keys(headers ?? {}).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers?.[key] : undefined;
}

export class OpenApiConnector implements Connector {
  name = 'openapi';

  constructor(private readonly specs: OpenApiSpec[]) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const spec = this.specs.find((entry) => action.startsWith(`${entry.id}.`));
    if (!spec) {
      return { ok: false, error: 'openapi_spec_not_found', errorCode: 'openapi_spec_not_found' };
    }
    const specId = spec.id;
    const operationId = action.slice(specId.length + 1);
    const operation = spec.operations.find((entry) => entry.operationId === operationId);
    if (!operation) {
      return { ok: false, error: 'openapi_operation_not_found', errorCode: 'openapi_operation_not_found' };
    }
    const suppliedHeaders = normalizeHttpHeaders(params.headers);
    const pathParams = recordParam(params.pathParams);
    const queryParams = recordParam(params.query);
    const cookieParams = recordParam(params.cookies);
    const missing = operation.parameters?.find((parameter) => {
      if (!parameter.required) return false;
      if (parameter.in === 'path' || parameter.in === 'query') return scalar((parameter.in === 'path' ? pathParams : queryParams)[parameter.name]) === undefined;
      if (parameter.in === 'header') return headerValue(suppliedHeaders, parameter.name) === undefined;
      return scalar(cookieParams[parameter.name]) === undefined && headerValue(suppliedHeaders, 'cookie') === undefined;
    });
    if (missing) {
      return { ok: false, error: `openapi_required_parameter_missing:${missing.in}:${missing.name}`, errorCode: 'invalid_params' };
    }
    if (operation.requestBody?.required && (params.body === undefined || params.body === null)) {
      return { ok: false, error: 'openapi_request_body_required', errorCode: 'invalid_params' };
    }

    const query = Object.fromEntries(
      Object.entries(queryParams)
        .map(([key, value]) => [key, scalar(value)] as const)
        .filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const path = substitutePath(operation.path, pathParams);
    const url = new URL(spec.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    const cookiePairs = Object.entries(cookieParams)
      .map(([key, value]) => [key, scalar(value)] as const)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`);
    const cookieHeader = headerValue(suppliedHeaders, 'cookie');
    const headersWithCookies = cookiePairs.length > 0
      ? {
          ...Object.fromEntries(Object.entries(suppliedHeaders ?? {}).filter(([key]) => key.toLowerCase() !== 'cookie')),
          cookie: [cookieHeader, ...cookiePairs].filter(Boolean).join('; '),
        }
      : suppliedHeaders;
    if (operation.securityRequired && Object.keys(headersWithCookies ?? {}).length === 0) {
      return { ok: false, error: 'openapi_security_headers_required', errorCode: 'invalid_params' };
    }

    const serializedBody = serializeHttpBody(params.body);
    if (!serializedBody.ok) return serializedBody;
    const headers = serializedBody.json ? withJsonContentType(headersWithCookies) : headersWithCookies;

    const result = await performHttpRequest({
      url: url.toString(),
      method: operation.method,
      headers,
      body: serializedBody.body,
      abortSignal: ctx.abortSignal,
    });

    if (!result.ok) {
      ctx.log({
        at: new Date().toISOString(),
        level: 'error',
        message: 'openapi.request_failed',
        data: { specId, operationId, error: result.error, status: result.status },
      });
      return { ok: false, error: result.error, errorCode: result.errorCode };
    }

    if (result.status >= 400) {
      ctx.log({
        at: new Date().toISOString(),
        level: 'error',
        message: 'openapi.request_failed',
        data: { specId, operationId, status: result.status, body: result.body.slice(0, 500) },
      });
      return { ok: false, error: `http_${result.status}`, errorCode: 'http_error_status' };
    }

    ctx.log({
      at: new Date().toISOString(),
      level: 'info',
      message: 'openapi.request',
      data: { specId, operationId, status: result.status, truncated: result.truncated },
    });

    return {
      ok: true,
      data: {
        status: result.status,
        body: result.body,
        truncated: result.truncated,
        untrusted: true,
      },
    };
  }
}

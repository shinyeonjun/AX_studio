import type { Connector, ConnectorContext, ConnectorResult } from '../modules/types.js';
import { performHttpRequest } from '../modules/http/request.js';
import type { OpenApiSpec } from './parse.js';

function substitutePath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key];
    return typeof value === 'string' || typeof value === 'number'
      ? encodeURIComponent(String(value))
      : `{${key}}`;
  });
}

export class OpenApiConnector implements Connector {
  name = 'openapi';

  constructor(private readonly specs: OpenApiSpec[]) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const [specId, operationId] = action.split('.', 2);
    const spec = this.specs.find((entry) => entry.id === specId);
    if (!spec) {
      return { ok: false, error: 'openapi_spec_not_found', errorCode: 'openapi_spec_not_found' };
    }
    const operation = spec.operations.find((entry) => entry.operationId === operationId);
    if (!operation) {
      return { ok: false, error: 'openapi_operation_not_found', errorCode: 'openapi_operation_not_found' };
    }

    const pathParams =
      params.pathParams && typeof params.pathParams === 'object' && !Array.isArray(params.pathParams)
        ? (params.pathParams as Record<string, unknown>)
        : {};
    const query =
      params.query && typeof params.query === 'object' && !Array.isArray(params.query)
        ? Object.fromEntries(
            Object.entries(params.query as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined;
    const path = substitutePath(operation.path, pathParams);
    const url = new URL(path, `${spec.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    const body = typeof params.body === 'string' ? params.body : undefined;

    const result = await performHttpRequest({
      url: url.toString(),
      method: operation.method,
      body,
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

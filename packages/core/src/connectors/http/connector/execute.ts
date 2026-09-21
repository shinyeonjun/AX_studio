import type { ConnectorContext, ConnectorResult } from '../../types.js';
import { buildHttpResponseArtifact } from '../../../contracts/artifacts/http-response.js';
import {
  isSupportedHttpMethod,
  matchHttpEndpoint,
  type HttpEndpoint,
} from '../connection.js';
import { performHttpRequest } from '../request.js';
import { resolveHttpRequestUrl } from '../url-security.js';
import { httpErrorDetails } from './errors.js';
import { hasNextHttpPage } from './completeness.js';
import {
  normalizeHttpHeaders,
  serializeHttpBody,
  withJsonContentType,
} from './payload.js';

export async function executeHttpAction(
  endpoints: readonly HttpEndpoint[],
  action: string,
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<ConnectorResult> {
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
  if (action === 'request' && method !== 'GET' && method !== 'HEAD') {
    return { ok: false, error: 'http_request_method_read_only', errorCode: 'invalid_params' };
  }

  const path = typeof params.path === 'string' ? params.path : '';
  const connectionId = typeof params.connectionId === 'string' ? params.connectionId : undefined;
  if (!connectionId?.trim() && endpoints.length > 1) {
    return { ok: false, error: 'http_connection_required', errorCode: 'invalid_params' };
  }
  const endpoint = matchHttpEndpoint(endpoints, connectionId);
  if (!endpoint) {
    return { ok: false, error: 'http_connection_not_found', errorCode: 'invalid_params' };
  }
  const resolved = resolveHttpRequestUrl(endpoint.baseUrl, path);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
  }

  const headers = normalizeHttpHeaders(params.headers);
  const serializedBody = serializeHttpBody(params.body);
  if (!serializedBody.ok) return serializedBody;

  const requestHeaders = serializedBody.json
    ? withJsonContentType(headers)
    : headers;
  const requestStartedAt = Date.now();
  const result = await performHttpRequest({
    url: resolved.value.url,
    method,
    headers: requestHeaders,
    body: serializedBody.body,
    auth: endpoint.auth,
    abortSignal: ctx.abortSignal,
  });
  const durationMs = Date.now() - requestStartedAt;

  if (!result.ok) {
    ctx.log({
      at: new Date().toISOString(),
      level: 'error',
      message: 'http.request_failed',
      data: { method, path, error: result.error, status: result.status, durationMs },
    });
    return { ok: false, error: result.error, errorCode: result.errorCode };
  }

  ctx.log({
    at: new Date().toISOString(),
    level: 'info',
    message: 'http.request',
    data: { method, path, status: result.status, truncated: result.truncated, durationMs },
  });

  if (result.status >= 400) {
    ctx.log({
      at: new Date().toISOString(),
      level: 'error',
      message: 'http.request_failed',
      data: { method, path, status: result.status, truncated: result.truncated, durationMs },
    });
    return {
      ok: false,
      error: `http_${result.status}`,
      errorCode: 'http_error',
      errorDetails: httpErrorDetails(result),
    };
  }

  const response = buildHttpResponseArtifact({
    executionId: ctx.executionId,
    url: resolved.value.url,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    body: result.body,
    truncated: result.truncated,
  });
  if (!result.truncated && (result.status === 206 || hasNextHttpPage(result.headers.link))) {
    // A next-page link does not truncate the received page. Keep dataset
    // completeness separate from transport/partial-content truncation.
    response.truncated = result.status === 206;
    response.completeness = { status: 'partial', reason: 'provider_limit', hasMore: true };
  }
  return {
    ok: true,
    data: response,
  };
}

import type { ConnectorContext, ConnectorResult } from '../../types.js';
import { buildHttpResponseArtifact } from '../../../contracts/artifacts/http-response.js';
import {
  isSupportedHttpMethod,
  matchHttpEndpoint,
  type HttpEndpoint,
} from '../connection.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { performHttpRequest } from '../request.js';
import type { PerformHttpRequestResult } from '../request/contracts.js';
import { resolveHttpRequestUrl } from '../url-security.js';
import { httpErrorDetails } from './errors.js';
import { hasNextHttpPage } from './completeness.js';
import { gatherHttpPages, gatheredCompleteness } from './pagination.js';
import {
  normalizeHttpHeaders,
  serializeHttpBody,
  withJsonContentType,
} from './payload.js';

const TRANSIENT_RETRY_MS = 700;

/** Failures that usually pass in a moment: the connection dropped, or a gateway was briefly busy. */
function passingHttpFault(result: PerformHttpRequestResult): boolean {
  return result.ok ? [502, 503, 504].includes(result.status) : result.errorCode === 'connection_failed';
}

const SENSITIVE_RESPONSE_HEADER =/(?:authorization|proxy-auth|cookie|set-cookie|api[-_]key|token|secret|password|credential|signature)/iu;

function safeResponseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_RESPONSE_HEADER.test(name)),
  );
}

export interface HttpConnectorOptions {
  /**
   * Allow loopback/private addresses. Registration refuses them, so production connectors never
   * set this; it exists for an explicitly local endpoint (and for tests against a local server).
   */
  allowPrivateNetwork?: boolean;
}

export async function executeHttpAction(
  endpoints: readonly HttpEndpoint[],
  action: string,
  params: Record<string, unknown>,
  ctx: ConnectorContext,
  options: HttpConnectorOptions = {},
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
  // Query strings frequently carry tokens or personal data; log only the path.
  const logPath = new URL(resolved.value.url).pathname;
  const requestStartedAt = Date.now();
  const send = () => performHttpRequest({
    url: resolved.value.url,
    method,
    headers: requestHeaders,
    body: serializedBody.body,
    auth: endpoint.auth,
    abortSignal: ctx.abortSignal,
    // Same rule as at registration, checked on every resolved address: a host that later
    // resolves to loopback or a private/metadata address (DNS rebinding) is refused.
    rejectPrivateDestination: options.allowPrivateNetwork !== true,
  });
  let result = await send();
  // A read that met a passing fault (a dropped connection, a busy gateway) is asked once more;
  // reading twice changes nothing, so only reads are.
  if ((method === 'GET' || method === 'HEAD') && passingHttpFault(result)) {
    await sleep(TRANSIENT_RETRY_MS, undefined, { signal: ctx.abortSignal }).catch(() => undefined);
    result = await send();
  }
  const durationMs = Date.now() - requestStartedAt;

  if (!result.ok) {
    ctx.log({
      at: new Date().toISOString(),
      level: 'error',
      message: 'http.request_failed',
      data: { method, path: logPath, error: result.error, status: result.status, durationMs },
    });
    return { ok: false, error: result.error, errorCode: result.errorCode };
  }

  ctx.log({
    at: new Date().toISOString(),
    level: 'info',
    message: 'http.request',
    data: { method, path: logPath, status: result.status, truncated: result.truncated, durationMs },
  });

  if (result.status >= 400) {
    ctx.log({
      at: new Date().toISOString(),
      level: 'error',
      message: 'http.request_failed',
      data: { method, path: logPath, status: result.status, truncated: result.truncated, durationMs },
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
    headers: safeResponseHeaders(result.headers),
    body: result.body,
    truncated: result.truncated,
  });
  if (!result.truncated && (result.status === 206 || hasNextHttpPage(result.headers.link))) {
    // A next-page link does not truncate the received page. Keep dataset
    // completeness separate from transport/partial-content truncation.
    response.truncated = result.status === 206;
    response.completeness = { status: 'partial', reason: 'provider_limit', hasMore: true };
  }
  if (params.allPages === true && method === 'GET' && !result.truncated && result.status < 300) {
    // A read registered as "every page": follow the provider's own page envelope, each page the
    // same request with only its page parameter moved, through the same address checks.
    const gathered = await gatherHttpPages(path, result.body, async (nextPath) => {
      const nextUrl = resolveHttpRequestUrl(endpoint.baseUrl, nextPath);
      if (!nextUrl.ok) return undefined;
      const next = await performHttpRequest({
        url: nextUrl.value.url,
        method,
        headers: requestHeaders,
        auth: endpoint.auth,
        abortSignal: ctx.abortSignal,
        rejectPrivateDestination: options.allowPrivateNetwork !== true,
      });
      return next.ok && !next.truncated && next.status < 300 ? next.body : undefined;
    });
    if (gathered.body !== undefined) {
      ctx.log({
        at: new Date().toISOString(),
        level: 'info',
        message: 'http.request_pages',
        data: { method, path: logPath, pages: gathered.pages, rows: gathered.rows, complete: gathered.complete },
      });
      response.body = gathered.body;
      response.completeness = gatheredCompleteness(gathered);
    }
  }
  return {
    ok: true,
    data: response,
  };
}

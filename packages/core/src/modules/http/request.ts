import type { HttpAuthConfig } from './connection.js';

export const HTTP_DEFAULT_TIMEOUT_MS = 30_000;
export const HTTP_DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export interface HttpRequestInput {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  auth?: HttpAuthConfig;
}

export interface HttpRequestResult {
  ok: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export interface HttpRequestError {
  ok: false;
  error: string;
  errorCode: string;
  status?: number;
}

export type PerformHttpRequestResult = HttpRequestResult | HttpRequestError;

function buildAuthHeaders(auth: HttpAuthConfig | undefined): Record<string, string> {
  if (!auth || auth.type === 'none') return {};
  if (auth.type === 'bearer' && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === 'apiKey' && auth.token) {
    const header = auth.header?.trim() || 'X-API-Key';
    return { [header]: auth.token };
  }
  if (auth.type === 'basic' && auth.username && auth.password) {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  const buffer = await response.arrayBuffer();
  const truncated = buffer.byteLength > maxBytes;
  const slice = truncated ? buffer.slice(0, maxBytes) : buffer;
  return { body: Buffer.from(slice).toString('utf8'), truncated };
}

export async function performHttpRequest(input: HttpRequestInput): Promise<PerformHttpRequestResult> {
  const method = input.method.trim().toUpperCase() || 'GET';
  const timeoutMs = input.timeoutMs ?? HTTP_DEFAULT_TIMEOUT_MS;
  const maxBytes = input.maxBytes ?? HTTP_DEFAULT_MAX_RESPONSE_BYTES;
  const headers = { ...buildAuthHeaders(input.auth), ...(input.headers ?? {}) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input.url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, error: 'redirect_not_allowed', errorCode: 'ssrf_blocked', status: response.status };
    }

    const headerRecord: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerRecord[key] = value;
    });

    if (method === 'HEAD') {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: headerRecord,
        body: '',
        truncated: false,
      };
    }

    const { body, truncated } = await readBodyWithLimit(response, maxBytes);
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: headerRecord,
      body,
      truncated,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { ok: false, error: 'request_timeout', errorCode: 'timeout' };
    }
    return { ok: false, error: (err as Error).message || 'request_failed', errorCode: 'http_error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHttpBaseUrl(
  baseUrl: string,
  auth?: HttpAuthConfig,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, error: 'invalid_base_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'unsupported_protocol' };
  }

  const result = await performHttpRequest({
    url: url.toString(),
    method: 'HEAD',
    auth,
    timeoutMs,
    maxBytes: 0,
  });
  if (!result.ok) {
    if (result.errorCode === 'timeout') return { ok: false, error: 'connection_timeout' };
    return { ok: false, error: result.error };
  }
  if (result.status >= 400) {
    if (result.status === 405) {
      const getResult = await performHttpRequest({
        url: url.toString(),
        method: 'GET',
        auth,
        timeoutMs,
        maxBytes: 1024,
      });
      if (!getResult.ok) return { ok: false, error: getResult.error };
      if (getResult.status >= 400) return { ok: false, status: getResult.status, error: `http_${getResult.status}` };
      return { ok: true, status: getResult.status };
    }
    return { ok: false, status: result.status, error: `http_${result.status}` };
  }
  return { ok: true, status: result.status };
}

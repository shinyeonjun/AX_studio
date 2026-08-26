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

function mergeHeadersWithAuth(
  headers: Record<string, string> | undefined,
  auth: HttpAuthConfig | undefined,
): Record<string, string> {
  const merged = { ...(headers ?? {}) };
  for (const [authHeader, value] of Object.entries(buildAuthHeaders(auth))) {
    for (const header of Object.keys(merged)) {
      if (header.toLowerCase() === authHeader.toLowerCase()) delete merged[header];
    }
    merged[authHeader] = value;
  }
  return merged;
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      return { body: '', truncated: true };
    }
  }

  if (!response.body) {
    return { body: '', truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      if (total + value.byteLength > maxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(chunks);
  const body = truncated
    ? new TextDecoder().decode(bytes, { stream: true })
    : bytes.toString('utf8');
  return { body, truncated };
}

export async function performHttpRequest(input: HttpRequestInput): Promise<PerformHttpRequestResult> {
  const method = input.method.trim().toUpperCase() || 'GET';
  const timeoutMs = input.timeoutMs ?? HTTP_DEFAULT_TIMEOUT_MS;
  const maxBytes = input.maxBytes ?? HTTP_DEFAULT_MAX_RESPONSE_BYTES;
  const headers = mergeHeadersWithAuth(input.headers, input.auth);

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

export function normalizeHttpBaseUrl(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'empty_base_url' };
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'unsupported_protocol' };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: 'invalid_base_url' };
  }
}

export async function probeHttpBaseUrl(
  baseUrl: string,
  auth?: HttpAuthConfig,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const normalized = normalizeHttpBaseUrl(baseUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  for (const method of ['HEAD', 'GET'] as const) {
    const result = await performHttpRequest({
      url: normalized.value,
      method,
      auth,
      timeoutMs,
      maxBytes: method === 'HEAD' ? 0 : 1024,
    });
    if (!result.ok) {
      if (result.errorCode === 'timeout') return { ok: false, error: 'connection_timeout' };
      if (result.errorCode === 'ssrf_blocked') return { ok: false, error: 'redirect_not_allowed' };
      continue;
    }
    // Any non-redirect HTTP response means the host is reachable.
    return { ok: true, status: result.status };
  }

  return { ok: false, error: 'connection_failed' };
}

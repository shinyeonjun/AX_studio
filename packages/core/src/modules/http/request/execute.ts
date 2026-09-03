import type { HttpAuthConfig } from '../connection.js';
import type { HttpRequestInput, PerformHttpRequestResult } from './contracts.js';
import { mergeHeadersWithAuth } from './headers.js';
import { readBodyWithLimit } from './body.js';
import { normalizeMaxBytes, normalizeTimeoutMs } from './normalize.js';

export async function performHttpRequest(input: HttpRequestInput): Promise<PerformHttpRequestResult> {
  const method = input.method.trim().toUpperCase() || 'GET';
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const maxBytes = normalizeMaxBytes(input.maxBytes);
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
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: 'redirect_not_allowed', errorCode: 'ssrf_blocked', status: response.status };
    }

    const headerRecord: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerRecord[key] = value;
    });

    if (method === 'HEAD') {
      await response.body?.cancel().catch(() => undefined);
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

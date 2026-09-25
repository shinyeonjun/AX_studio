import type { HttpRequestInput, PerformHttpRequestResult } from './contracts.js';
import { mergeHeadersWithAuth } from './headers.js';
import { readBodyWithLimit } from './body.js';
import { normalizeMaxBytes, normalizeTimeoutMs } from './normalize.js';
import { isPrivateHttpHostname } from '../url-security.js';
import {
  createPrivateDestinationAgent,
  PRIVATE_DESTINATION_ERROR_CODE,
} from './private-destination.js';

export async function performHttpRequest(input: HttpRequestInput): Promise<PerformHttpRequestResult> {
  if (input.abortSignal?.aborted) return { ok: false, error: 'request_aborted', errorCode: 'aborted' };
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.url);
  } catch {
    return { ok: false, error: 'invalid_url', errorCode: 'invalid_params' };
  }
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return { ok: false, error: 'unsupported_protocol', errorCode: 'ssrf_blocked' };
  }
  if (requestUrl.username || requestUrl.password) {
    return { ok: false, error: 'url_credentials_not_allowed', errorCode: 'ssrf_blocked' };
  }
  if (input.rejectPrivateDestination && isPrivateHttpHostname(requestUrl.hostname)) {
    return { ok: false, error: 'private_destination_not_allowed', errorCode: 'ssrf_blocked' };
  }
  const method = input.method.trim().toUpperCase() || 'GET';
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const maxBytes = normalizeMaxBytes(input.maxBytes);
  const headers = mergeHeadersWithAuth(input.headers, input.auth);

  let controller: AbortController | undefined;
  const abortExternal = () => controller?.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dispatcher: Awaited<ReturnType<typeof createPrivateDestinationAgent>> | undefined;

  try {
    dispatcher = input.rejectPrivateDestination ? await createPrivateDestinationAgent() : undefined;
    input.abortSignal?.throwIfAborted();
    const requestController = new AbortController();
    controller = requestController;
    input.abortSignal?.addEventListener('abort', abortExternal, { once: true });
    timer = setTimeout(() => requestController.abort(), timeoutMs);
    const response = await fetch(requestUrl.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
      redirect: 'manual',
      signal: requestController.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as unknown as RequestInit);

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
    requestController.signal.throwIfAborted();
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: headerRecord,
      body,
      truncated,
    };
  } catch (err) {
    if (input.abortSignal?.aborted) return { ok: false, error: 'request_aborted', errorCode: 'aborted' };
    if ((err as Error).name === 'AbortError') {
      return { ok: false, error: 'request_timeout', errorCode: 'timeout' };
    }
    if ((err as NodeJS.ErrnoException).code === PRIVATE_DESTINATION_ERROR_CODE) {
      return { ok: false, error: 'private_destination_not_allowed', errorCode: 'ssrf_blocked' };
    }
    return { ok: false, error: (err as Error).message || 'request_failed', errorCode: 'http_error' };
  } finally {
    await dispatcher?.close().catch(() => undefined);
    if (timer) clearTimeout(timer);
    input.abortSignal?.removeEventListener('abort', abortExternal);
  }
}

import type { HttpAuthConfig } from '../connection.js';
import { performHttpRequest } from './execute.js';
import { normalizeHttpBaseUrl } from './normalize.js';

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

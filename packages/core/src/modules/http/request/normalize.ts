import {
  HTTP_DEFAULT_MAX_RESPONSE_BYTES,
  HTTP_DEFAULT_TIMEOUT_MS,
} from './contracts.js';

export function normalizeTimeoutMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : HTTP_DEFAULT_TIMEOUT_MS;
}

export function normalizeMaxBytes(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : HTTP_DEFAULT_MAX_RESPONSE_BYTES;
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

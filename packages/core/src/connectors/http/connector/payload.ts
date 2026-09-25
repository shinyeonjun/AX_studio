export type SerializedHttpBody =
  | { ok: true; body?: string; json: boolean }
  | { ok: false; error: string; errorCode: 'invalid_params' };

const HTTP_DEFAULT_MAX_REQUEST_BYTES = 1_048_576;

function isSafeHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) && name.length <= 256;
}

export function normalizeHttpHeaders(value: unknown): Record<string, string> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === 'string' &&
            typeof entry[1] === 'string' &&
            isSafeHeaderName(entry[0]) &&
            !/[\r\n]/.test(entry[1]) &&
            entry[1].length <= 8_192,
        ),
      )
    : undefined;
}

export function serializeHttpBody(value: unknown): SerializedHttpBody {
  if (value == null) return { ok: true, body: undefined, json: false };
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8') <= HTTP_DEFAULT_MAX_REQUEST_BYTES
      ? { ok: true, body: value, json: false }
      : { ok: false, error: 'http_body_too_large', errorCode: 'invalid_params' };
  }

  try {
    const body = JSON.stringify(value);
    if (body === undefined) return { ok: false, error: 'http_body_not_serializable', errorCode: 'invalid_params' };
    if (Buffer.byteLength(body, 'utf8') > HTTP_DEFAULT_MAX_REQUEST_BYTES) {
      return { ok: false, error: 'http_body_too_large', errorCode: 'invalid_params' };
    }
    return { ok: true, body, json: true };
  } catch {
    return { ok: false, error: 'http_body_not_serializable', errorCode: 'invalid_params' };
  }
}

export function withJsonContentType(headers: Record<string, string> | undefined): Record<string, string> {
  if (Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'content-type')) return headers ?? {};
  return { ...(headers ?? {}), 'content-type': 'application/json' };
}

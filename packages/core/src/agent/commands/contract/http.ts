import { boundedText } from './values.js';

/** Keep saved endpoint metadata useful without echoing URL credentials/query secrets. */
export function safeHttpBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid base URL]';
  }
}

const MAX_READ_ERROR_BODY_CHARS = 4_000;

/** Keep provider failure details structured, bounded, and free of response headers. */
export function boundedReadErrorDetails(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return undefined;
  }
  const statusText = boundedText(record.statusText, 120);
  const rawBody = typeof record.body === 'string' ? record.body : undefined;
  const body = rawBody?.slice(0, MAX_READ_ERROR_BODY_CHARS);
  return {
    status,
    ...(statusText ? { statusText } : {}),
    ...(body === undefined ? {} : { body }),
    truncated: record.truncated === true || (rawBody !== undefined && rawBody.length > body!.length),
  };
}

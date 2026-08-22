import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_DEFAULT_PORT = 18_789;
export const WEBHOOK_MAX_PAYLOAD_BYTES = 262_144;

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) throw new Error('webhook_path_required');
  if (trimmed.includes('..') || trimmed.includes('://')) {
    throw new Error('invalid_webhook_path');
  }
  return trimmed;
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

function secretsMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Validates shared secret header or HMAC signature (sha256=). */
export function verifyWebhookAuth(
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  rawBody: Buffer,
): boolean {
  if (!secret.trim()) return false;

  const headerSecret =
    readHeader(headers, 'x-ax-webhook-secret') ??
    readHeader(headers, 'authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (headerSecret && secretsMatch(headerSecret, secret)) return true;

  const signature = readHeader(headers, 'x-ax-signature');
  if (signature?.startsWith('sha256=')) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return secretsMatch(signature.slice('sha256='.length), expected);
  }

  return false;
}

export function buildWebhookLocalUrl(port: number, path: string): string {
  const normalized = normalizeWebhookPath(path);
  return `http://127.0.0.1:${port}/hooks/${normalized}`;
}

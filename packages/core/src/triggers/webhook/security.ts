import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_MAX_PAYLOAD_BYTES = 262_144;
const WEBHOOK_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1_000;

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

export interface WebhookSignatureContext {
  method: string;
  path: string;
  eventId: string;
  timestamp: string;
}

export function webhookSignaturePayload(context: WebhookSignatureContext, rawBody: Buffer): string {
  return [context.method.trim().toUpperCase(), context.path, context.eventId, context.timestamp, rawBody.toString('utf8')].join('\n');
}

export class WebhookReplayCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly maxEntries = 4_096,
    private readonly ttlMs = WEBHOOK_SIGNATURE_MAX_SKEW_MS,
  ) {}

  claim(key: string, now = Date.now()): boolean {
    for (const [entry, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(entry);
    }
    if (this.entries.has(key)) return false;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(key, now + this.ttlMs);
    return true;
  }

  release(key: string): void {
    this.entries.delete(key);
  }
}

/** Validates shared secret header or HMAC signature (sha256=). */
export function verifyWebhookAuth(
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  rawBody: Buffer,
  signatureContext?: WebhookSignatureContext,
): boolean {
  if (!secret.trim()) return false;

  const signature = readHeader(headers, 'x-ax-signature');
  if (signature?.startsWith('sha256=')) {
    if (!signatureContext) return false;
    const timestamp = Number(signatureContext.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp * 1_000) > WEBHOOK_SIGNATURE_MAX_SKEW_MS) return false;
    const expected = createHmac('sha256', secret)
      .update(webhookSignaturePayload(signatureContext, rawBody))
      .digest('hex');
    return secretsMatch(signature.slice('sha256='.length), expected);
  }

  const headerSecret =
    readHeader(headers, 'x-ax-webhook-secret') ??
    readHeader(headers, 'authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (headerSecret && secretsMatch(headerSecret, secret)) return true;

  return false;
}

export function buildWebhookLocalUrl(port: number, path: string): string {
  const normalized = normalizeWebhookPath(path);
  const encodedPath = normalized.split('/').map(encodeURIComponent).join('/');
  return `http://127.0.0.1:${port}/hooks/${encodedPath}`;
}

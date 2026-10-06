import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_MAX_PAYLOAD_BYTES = 262_144;
const WEBHOOK_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1_000;
/** Minimum length for newly configured shared secrets (32 chars ~ 192+ bits for random secrets). */
export const WEBHOOK_MIN_SECRET_LENGTH = 32;

export function isWebhookSecretStrong(secret: string): boolean {
  return secret.trim().length >= WEBHOOK_MIN_SECRET_LENGTH;
}

/** True when an `x-ax-timestamp` value (unix seconds) is within the accepted clock skew. */
export function isWebhookTimestampFresh(timestamp: string, now = Date.now()): boolean {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && Math.abs(now - seconds * 1_000) <= WEBHOOK_SIGNATURE_MAX_SKEW_MS;
}

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

const FAILED_AUTH_THRESHOLD = 5;
const FAILED_AUTH_WINDOW_MS = 60_000;
const FAILED_AUTH_BASE_BLOCK_MS = 1_000;
const FAILED_AUTH_MAX_BLOCK_MS = 5 * 60 * 1_000;

interface FailedAuthEntry {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
}

/**
 * Per-client failed-auth backoff. After a few failures inside a window the
 * client is blocked with an exponentially growing delay, so a shared secret
 * cannot be brute-forced at line rate. Memory is bounded by `maxClients`.
 */
export class WebhookAuthFailureLimiter {
  private readonly entries = new Map<string, FailedAuthEntry>();

  constructor(private readonly maxClients = 4_096) {}

  /** Milliseconds the client must wait before another attempt (0 = allowed). */
  retryAfterMs(client: string, now = Date.now()): number {
    const entry = this.entries.get(client);
    if (!entry) return 0;
    return Math.max(0, entry.blockedUntil - now);
  }

  recordFailure(client: string, now = Date.now()): void {
    let entry = this.entries.get(client);
    if (!entry || (now - entry.firstFailureAt > FAILED_AUTH_WINDOW_MS && entry.blockedUntil <= now)) {
      entry = { failures: 0, firstFailureAt: now, blockedUntil: 0 };
    }
    entry.failures += 1;
    if (entry.failures >= FAILED_AUTH_THRESHOLD) {
      const exponent = entry.failures - FAILED_AUTH_THRESHOLD;
      entry.blockedUntil = now + Math.min(FAILED_AUTH_MAX_BLOCK_MS, FAILED_AUTH_BASE_BLOCK_MS * 2 ** Math.min(exponent, 20));
    }
    this.entries.delete(client);
    if (this.entries.size >= this.maxClients) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(client, entry);
  }

  recordSuccess(client: string): void {
    this.entries.delete(client);
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
    if (!isWebhookTimestampFresh(signatureContext.timestamp)) return false;
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

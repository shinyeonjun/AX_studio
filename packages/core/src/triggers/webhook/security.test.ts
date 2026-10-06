import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  WebhookAuthFailureLimiter,
  buildWebhookLocalUrl,
  isWebhookSecretStrong,
  normalizeWebhookPath,
  verifyWebhookAuth,
  webhookSignaturePayload,
} from './security.js';

describe('webhook security', () => {
  const secret = 'shared-secret';
  const body = Buffer.from('{"ok":true}', 'utf8');

  it('accepts matching shared secret header', () => {
    expect(verifyWebhookAuth({ 'x-ax-webhook-secret': secret }, secret, body)).toBe(true);
  });

  it('accepts valid HMAC signature', () => {
    const signatureContext = {
      method: 'POST',
      path: 'invoice-paid',
      eventId: 'evt-1',
      timestamp: String(Math.floor(Date.now() / 1_000)),
    };
    const digest = createHmac('sha256', secret)
      .update(webhookSignaturePayload(signatureContext, body))
      .digest('hex');
    expect(verifyWebhookAuth(
      { 'x-ax-signature': `sha256=${digest}` },
      secret,
      body,
      signatureContext,
    )).toBe(true);
  });

  it('rejects invalid auth', () => {
    expect(verifyWebhookAuth({ 'x-ax-webhook-secret': 'wrong' }, secret, body)).toBe(false);
    expect(verifyWebhookAuth({}, secret, body)).toBe(false);
  });

  it('normalizes webhook paths', () => {
    expect(normalizeWebhookPath('/invoice/')).toBe('invoice');
    expect(buildWebhookLocalUrl(18789, 'invoice')).toBe('http://127.0.0.1:18789/hooks/invoice');
  });

  it('encodes webhook path segments without changing their hierarchy', () => {
    const url = new URL(buildWebhookLocalUrl(18789, '결제 완료/customer?#%'));

    expect(url.pathname).toBe('/hooks/%EA%B2%B0%EC%A0%9C%20%EC%99%84%EB%A3%8C/customer%3F%23%25');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname.slice('/hooks/'.length))).toBe('결제 완료/customer?#%');
  });

  it('requires 32-character shared secrets', () => {
    expect(isWebhookSecretStrong('x'.repeat(31))).toBe(false);
    expect(isWebhookSecretStrong('x'.repeat(32))).toBe(true);
  });

  it('blocks a client with exponential backoff and forgets it after success', () => {
    const limiter = new WebhookAuthFailureLimiter();
    const now = 1_000_000;
    for (let index = 0; index < 4; index += 1) limiter.recordFailure('a', now);
    expect(limiter.retryAfterMs('a', now)).toBe(0);
    limiter.recordFailure('a', now);
    expect(limiter.retryAfterMs('a', now)).toBe(1_000);
    limiter.recordFailure('a', now);
    expect(limiter.retryAfterMs('a', now)).toBe(2_000);
    expect(limiter.retryAfterMs('b', now)).toBe(0);
    limiter.recordSuccess('a');
    expect(limiter.retryAfterMs('a', now)).toBe(0);
  });

  it('bounds the number of tracked clients', () => {
    const limiter = new WebhookAuthFailureLimiter(2);
    for (const client of ['a', 'b', 'c']) {
      for (let index = 0; index < 5; index += 1) limiter.recordFailure(client, 0);
    }
    expect(limiter.retryAfterMs('a', 0)).toBe(0);
    expect(limiter.retryAfterMs('c', 0)).toBeGreaterThan(0);
  });
});

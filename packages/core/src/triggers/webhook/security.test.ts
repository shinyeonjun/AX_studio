import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  WebhookAuthFailureLimiter,
  WebhookReplayCache,
  buildWebhookLocalUrl,
  isWebhookSecretStrong,
  normalizeWebhookPath,
  verifyWebhookAuth,
  webhookSignaturePayload,
} from './security.js';
import { authClientKey } from './listener/transport.js';

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

describe('a signed request is accepted once', () => {
  const skew = 5 * 60_000;

  it('stays refused for as long as its timestamp is still accepted', () => {
    const cache = new WebhookReplayCache();
    const arrivedAt = 1_000_000_000_000;
    const signedAhead = String((arrivedAt + skew - 1_000) / 1_000);
    expect(cache.claim('e1:sig', signedAhead, arrivedAt)).toBe(true);
    // Still a fresh timestamp nine minutes later, so still a replay.
    expect(cache.claim('e1:sig', signedAhead, arrivedAt + 9 * 60_000)).toBe(false);
    expect(cache.claim('e1:sig', signedAhead, arrivedAt + 2 * skew)).toBe(true);
  });
});

describe('the address failed sign-ins are counted against', () => {
  const request = (remoteAddress: string, headers: Record<string, string | string[]>) =>
    ({ socket: { remoteAddress }, headers }) as never;

  it('behind a tunnel, is the hop the tunnel appended, not one the caller chose', () => {
    const viaTunnel = (spoofed: string) => authClientKey(request('127.0.0.1', {
      'cf-connecting-ip': spoofed,
      'x-forwarded-for': `${spoofed}, 203.0.113.9`,
    }));
    expect(viaTunnel('198.51.100.1')).toBe(viaTunnel('198.51.100.2'));
    expect(viaTunnel('198.51.100.1')).toContain('203.0.113.9');
  });

  it('ignores forwarded headers from a direct client', () => {
    expect(authClientKey(request('203.0.113.5', { 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.5');
  });
});

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildWebhookLocalUrl, normalizeWebhookPath, verifyWebhookAuth } from './security.js';

describe('webhook security', () => {
  const secret = 'shared-secret';
  const body = Buffer.from('{"ok":true}', 'utf8');

  it('accepts matching shared secret header', () => {
    expect(verifyWebhookAuth({ 'x-ax-webhook-secret': secret }, secret, body)).toBe(true);
  });

  it('accepts valid HMAC signature', () => {
    const digest = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookAuth({ 'x-ax-signature': `sha256=${digest}` }, secret, body)).toBe(true);
  });

  it('rejects invalid auth', () => {
    expect(verifyWebhookAuth({ 'x-ax-webhook-secret': 'wrong' }, secret, body)).toBe(false);
    expect(verifyWebhookAuth({}, secret, body)).toBe(false);
  });

  it('normalizes webhook paths', () => {
    expect(normalizeWebhookPath('/invoice/')).toBe('invoice');
    expect(buildWebhookLocalUrl(18789, 'invoice')).toBe('http://127.0.0.1:18789/hooks/invoice');
  });
});

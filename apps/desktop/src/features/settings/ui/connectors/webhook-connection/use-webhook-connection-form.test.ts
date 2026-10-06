import { describe, expect, it } from 'vitest';
import {
  generateWebhookSecret,
  WEBHOOK_MIN_SECRET_LENGTH,
  webhookSecretError,
} from './use-webhook-connection-form';

describe('webhook secret helpers', () => {
  it('generates distinct base64url secrets from 32 random bytes', () => {
    const first = generateWebhookSecret();
    const second = generateWebhookSecret();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.length).toBeGreaterThanOrEqual(WEBHOOK_MIN_SECRET_LENGTH);
    expect(first).not.toBe(second);
    expect(webhookSecretError(first, false)).toBeUndefined();
  });

  it('rejects short secrets and requires one for a new connection', () => {
    expect(webhookSecretError('short', false)).toContain(`${WEBHOOK_MIN_SECRET_LENGTH}자`);
    expect(webhookSecretError('x'.repeat(WEBHOOK_MIN_SECRET_LENGTH - 1), true)).toBeDefined();
    expect(webhookSecretError('   ', false)).toBeDefined();
    // Connected listeners may keep the stored secret by leaving the field empty.
    expect(webhookSecretError('', true)).toBeUndefined();
    expect(webhookSecretError('x'.repeat(WEBHOOK_MIN_SECRET_LENGTH), false)).toBeUndefined();
  });
});

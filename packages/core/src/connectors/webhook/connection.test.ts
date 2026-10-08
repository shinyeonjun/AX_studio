import { describe, expect, it } from 'vitest';
import { getWebhookConnectionStatus, mergeWebhookSecret, parseWebhookConnectionConfig } from './connection.js';

describe('webhook connection settings', () => {
  it('reads a saved row, trimming text and defaulting the port', () => {
    expect(parseWebhookConnectionConfig({ port: 8787, label: ' 주문 알림 ', tunnelUrl: ' ', secretStored: true }))
      .toMatchObject({ port: 8787, label: '주문 알림', tunnelUrl: undefined, secretStored: true });
    expect(parseWebhookConnectionConfig({})?.port).toBe(18_789);
    expect(parseWebhookConnectionConfig({ port: 70_000 })).toBeNull();
    expect(parseWebhookConnectionConfig('8787')).toBeNull();
  });

  it('only starts with a secret that is not blank', () => {
    const config = parseWebhookConnectionConfig({ port: 8787 })!;
    expect(mergeWebhookSecret(config, '  ')).toBeNull();
    expect(mergeWebhookSecret(config, null)).toBeNull();
    expect(mergeWebhookSecret(config, ' s3cret ')).toMatchObject({ port: 8787, secret: 's3cret' });
  });

  it('reads as connected only when switched on with a stored secret, and never shows the secret', () => {
    expect(getWebhookConnectionStatus({ port: 8787, secretStored: false }, true)).toMatchObject({ connected: false });
    expect(getWebhookConnectionStatus({ port: 8787, secretStored: true, lastError: '포트 사용 중' }, false))
      .toEqual({ connected: false, lastError: '포트 사용 중' });
    const status = getWebhookConnectionStatus({ port: 8787, secretStored: true, secret: 'leak' }, true);
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain('leak');
  });
});

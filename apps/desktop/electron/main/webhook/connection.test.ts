import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync, WorkflowStore } from '@ax-studio/core';

const credentialState = vi.hoisted(() => ({ secret: null as string | null }));

vi.mock('../credential-store.js', () => ({
  getOsSecret: vi.fn(async () => credentialState.secret),
  setOsSecret: vi.fn(async (_key: string, value: string) => {
    credentialState.secret = value;
  }),
  deleteOsSecret: vi.fn(async () => {
    credentialState.secret = null;
  }),
}));

import { hydrateWebhookConnection, validateAndConnectWebhook } from './connection.js';

const STRONG_SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(40);

describe('Webhook desktop connection lifecycle', () => {
  afterEach(() => {
    credentialState.secret = null;
  });

  it('does not leave a failed listener as a connected connection', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const refreshTransports = vi.fn().mockRejectedValue(new Error('Webhook listener unavailable'));

    await expect(
      validateAndConnectWebhook(
        store,
        { port: 18_789, secret: STRONG_SECRET, label: 'Local hooks' },
        refreshTransports,
      ),
    ).rejects.toThrow('외부 신호 받기를 시작하지 못했어요. 포트 번호를 바꿔 다시 시도해 주세요.');

    expect(store.getConnections()).toEqual([
      expect.objectContaining({
        connector: 'webhook',
        connected: false,
        config: expect.objectContaining({
          port: 18_789,
          label: 'Local hooks',
          secretStored: false,
          lastError: '외부 신호 받기를 시작하지 못했어요. 포트 번호를 바꿔 다시 시도해 주세요.',
        }),
      }),
    ]);
    expect(credentialState.secret).toBeNull();
  });

  it('rejects secrets shorter than 32 characters without storing them', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const refreshTransports = vi.fn();
    await expect(
      validateAndConnectWebhook(store, { port: 18_789, secret: 'short-secret' }, refreshTransports),
    ).rejects.toThrow('32');
    expect(credentialState.secret).toBeNull();
    expect(refreshTransports).not.toHaveBeenCalled();
  });

  it('keeps the previous secret and working connection when a rotated listener fails', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    credentialState.secret = STRONG_SECRET;
    store.setConnection('webhook', true, { port: 18_789, secretStored: true });
    const refreshTransports = vi.fn()
      .mockRejectedValueOnce(new Error('listen EADDRINUSE: address already in use :::18789'))
      .mockResolvedValue(undefined);

    await expect(
      validateAndConnectWebhook(store, { port: 18_790, secret: OTHER_SECRET }, refreshTransports),
    ).rejects.toThrow('이 포트를 다른 프로그램이 쓰고 있어요. 다른 포트 번호를 입력해 주세요.');

    expect(credentialState.secret).toBe(STRONG_SECRET);
    expect(refreshTransports).toHaveBeenCalledTimes(2);
    expect(store.getConnections()).toEqual([
      expect.objectContaining({
        connector: 'webhook',
        connected: true,
        config: expect.objectContaining({ port: 18_789, lastError: '이 포트를 다른 프로그램이 쓰고 있어요. 다른 포트 번호를 입력해 주세요.' }),
      }),
    ]);
  });

  it('migrates a legacy inline secret into the credential store', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    store.setConnection('webhook', true, { port: 18_789, secret: STRONG_SECRET });

    await hydrateWebhookConnection(store);

    expect(credentialState.secret).toBe(STRONG_SECRET);
    const [connection] = store.getConnections();
    expect(connection?.connected).toBe(true);
    expect(connection?.config).not.toHaveProperty('secret');
    expect(connection?.config).toMatchObject({ secretStored: true });
  });
});

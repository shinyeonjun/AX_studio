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
    ).rejects.toThrow('Webhook listener unavailable');

    expect(store.getConnections()).toEqual([
      expect.objectContaining({
        connector: 'webhook',
        connected: false,
        config: expect.objectContaining({
          port: 18_789,
          label: 'Local hooks',
          secretStored: false,
          lastError: 'Webhook listener unavailable',
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
      .mockRejectedValueOnce(new Error('port busy'))
      .mockResolvedValue(undefined);

    await expect(
      validateAndConnectWebhook(store, { port: 18_790, secret: OTHER_SECRET }, refreshTransports),
    ).rejects.toThrow('port busy');

    expect(credentialState.secret).toBe(STRONG_SECRET);
    expect(refreshTransports).toHaveBeenCalledTimes(2);
    expect(store.getConnections()).toEqual([
      expect.objectContaining({
        connector: 'webhook',
        connected: true,
        config: expect.objectContaining({ port: 18_789, lastError: 'port busy' }),
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

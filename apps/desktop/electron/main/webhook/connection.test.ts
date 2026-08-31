import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync, WorkflowStore, type WorkflowRuntime } from '@ax-studio/core';

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

import { validateAndConnectWebhook } from './connection.js';

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
        {} as WorkflowRuntime,
        { port: 18_789, secret: 'hook-secret', label: 'Local hooks' },
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
          secretStored: true,
          lastError: 'Webhook listener unavailable',
        }),
      }),
    ]);
  });
});

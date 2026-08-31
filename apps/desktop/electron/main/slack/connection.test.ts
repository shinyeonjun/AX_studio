import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync, WorkflowStore, type WorkflowRuntime } from '@ax-studio/core';

const credentialState = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock('../credential-store.js', () => ({
  getOsSecret: credentialState.read,
  setOsSecret: vi.fn(),
  deleteOsSecret: vi.fn(),
}));

import { getSlackSecretForConnect, hydrateSlackConnector } from './connection.js';

describe('Slack desktop connection hydration', () => {
  afterEach(() => {
    credentialState.read.mockReset();
  });

  it('keeps startup recoverable when the stored OS secret cannot be decrypted', async () => {
    credentialState.read.mockRejectedValue(new Error('safeStorage decrypt failed'));
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    store.setConnection('slack', true, {
      team: 'AX Studio',
      botUser: 'ax-bot',
      connectedAt: '2026-08-31T00:00:00.000Z',
      tokenStored: true,
      appTokenStored: true,
    });
    const runtime = { setConnector: vi.fn() } as unknown as WorkflowRuntime;

    await expect(hydrateSlackConnector(store, runtime)).resolves.toBeNull();

    expect(store.getConnections()).toEqual([
      expect.objectContaining({
        connector: 'slack',
        connected: false,
        config: {
          team: 'AX Studio',
          botUser: 'ax-bot',
          connectedAt: '2026-08-31T00:00:00.000Z',
          tokenStored: true,
          appTokenStored: true,
          lastError: '저장된 Slack 인증 정보를 읽을 수 없습니다. 다시 연결해 주세요.',
        },
      }),
    ]);
    expect(runtime.setConnector).not.toHaveBeenCalled();
  });

  it('allows a replacement bot token when the stored OS secret cannot be decrypted', async () => {
    credentialState.read.mockRejectedValue(new Error('safeStorage decrypt failed'));

    await expect(getSlackSecretForConnect('xoxb-replacement')).resolves.toBeNull();
  });

  it('reports the stored-secret error when no replacement token is supplied', async () => {
    credentialState.read.mockRejectedValue(new Error('safeStorage decrypt failed'));

    await expect(getSlackSecretForConnect()).rejects.toThrow(
      '저장된 Slack 인증 정보를 읽을 수 없습니다. 다시 연결해 주세요.',
    );
  });
});

import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('../gmail/connection.js', () => ({ hydrateGmailConnector: vi.fn() }));
vi.mock('../credential-store.js', () => ({
  isCredentialUnavailableError: (error: { code?: string }) => error?.code === 'credential_decrypt_failed',
}));
vi.mock('../slack/connection.js', () => ({ hydrateSlackConnector: vi.fn(async () => null) }));
vi.mock('../http/connection.js', () => ({ hydrateHttpConnector: vi.fn() }));
vi.mock('../webhook/connection.js', () => ({ hydrateWebhookConnection: vi.fn() }));
vi.mock('../rdb/connection.js', () => ({ hydrateRdbConnector: vi.fn(), fillRdbTableDescriptions: vi.fn(async () => undefined) }));
vi.mock('../openapi/connection.js', () => ({ hydrateOpenApiConnector: vi.fn() }));

import { hydrateConnectorsForStartup, CREDENTIAL_UNAVAILABLE_ERROR } from './connectors.js';
import { hydrateGmailConnector } from '../gmail/connection.js';
import { hydrateHttpConnector } from '../http/connection.js';
import { hydrateRdbConnector } from '../rdb/connection.js';

it('deactivates a saved mock MCP connection while preserving its config', async () => {
  const config = { serverId: 'local', tools: [{ name: 'echo' }] };
  const setConnection = vi.fn();
  const core = {
    store: { getConnections: () => [{ connector: 'mcp', connected: true, config }], setConnection },
    runtime: {},
  } as unknown as Parameters<typeof hydrateConnectorsForStartup>[0];

  await hydrateConnectorsForStartup(core);

  expect(setConnection).toHaveBeenCalledWith('mcp', false, config);
});

it('isolates connector failures and marks only unreadable credentials as disconnected', async () => {
  vi.mocked(hydrateGmailConnector).mockRejectedValueOnce(Object.assign(new Error('decrypt'), { code: 'credential_decrypt_failed' }));
  vi.mocked(hydrateHttpConnector).mockRejectedValueOnce(new Error('network down'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const setConnection = vi.fn();
  const gmailConfig = { account: 'a@example.com' };
  const core = {
    store: {
      getConnections: () => [
        { connector: 'gmail', connected: true, config: gmailConfig },
        { connector: 'http', connected: true, config: {} },
      ],
      setConnection,
    },
    runtime: {},
  } as unknown as Parameters<typeof hydrateConnectorsForStartup>[0];

  await expect(hydrateConnectorsForStartup(core)).resolves.toBeNull();

  expect(setConnection).toHaveBeenCalledWith('gmail', false, { ...gmailConfig, lastError: CREDENTIAL_UNAVAILABLE_ERROR });
  // A transient (non-credential) failure keeps the saved connection for the next launch.
  expect(setConnection).not.toHaveBeenCalledWith('http', expect.anything(), expect.anything());
  expect(hydrateRdbConnector).toHaveBeenCalled();
  error.mockRestore();
});

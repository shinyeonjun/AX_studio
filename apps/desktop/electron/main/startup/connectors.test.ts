import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({ gmail: vi.fn(), slack: vi.fn(), http: vi.fn(), webhook: vi.fn(),
  rdb: vi.fn(), openapi: vi.fn(), mcp: vi.fn() }));
vi.mock('../gmail/connection.js', () => ({ hydrateGmailConnector: fixtures.gmail }));
vi.mock('../gmail/oauth-client.js', () => ({ loadGoogleDesktopClient: vi.fn() }));
vi.mock('../slack/connection.js', () => ({ hydrateSlackConnector: fixtures.slack }));
vi.mock('../http/connection.js', () => ({ hydrateHttpConnector: fixtures.http }));
vi.mock('../webhook/connection.js', () => ({ hydrateWebhookConnection: fixtures.webhook }));
vi.mock('../rdb/connection.js', () => ({ hydrateRdbConnector: fixtures.rdb }));
vi.mock('../openapi/connection.js', () => ({ hydrateOpenApiConnector: fixtures.openapi }));
vi.mock('../mcp/connection.js', () => ({ hydrateMcpConnector: fixtures.mcp }));
import { hydrateConnectorsForStartup } from './connectors.js';

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('keeps production startup usable when one saved connector cannot be decrypted', async () => {
  vi.stubEnv('AX_E2E', '');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fixtures.gmail.mockRejectedValue(new Error('decrypt failed: secret-do-not-print'));
  fixtures.slack.mockResolvedValue({ token: 'isolated-slack' });
  const config = { credentialRef: { connector: 'gmail', connectionId: 'saved-id' } };
  const connections = [{ connector: 'gmail', connected: true, config }];
  const store = { getConnections: () => connections, setConnection: vi.fn(), setSetting: vi.fn() };
  const runtime = { setConnector: vi.fn() };
  const result = await hydrateConnectorsForStartup({ store, runtime } as never);
  expect(result).toEqual({ token: 'isolated-slack' });
  expect(fixtures.http).toHaveBeenCalled();
  expect(fixtures.mcp).toHaveBeenCalled();
  expect(runtime.setConnector).toHaveBeenCalledWith('gmail', null);
  expect(store.setConnection).toHaveBeenCalledWith('gmail', false, config);
  expect(store.setSetting).toHaveBeenCalledWith('startup.connectorErrors', expect.objectContaining({ gmail: expect.any(String) }));
  expect(JSON.stringify(warning.mock.calls)).not.toContain('secret-do-not-print');
});

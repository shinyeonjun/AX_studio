import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('../gmail/connection.js', () => ({ hydrateGmailConnector: vi.fn() }));
vi.mock('../slack/connection.js', () => ({ hydrateSlackConnector: vi.fn(async () => null) }));
vi.mock('../http/connection.js', () => ({ hydrateHttpConnector: vi.fn() }));
vi.mock('../webhook/connection.js', () => ({ hydrateWebhookConnection: vi.fn() }));
vi.mock('../rdb/connection.js', () => ({ hydrateRdbConnector: vi.fn() }));
vi.mock('../openapi/connection.js', () => ({ hydrateOpenApiConnector: vi.fn() }));

import { hydrateConnectorsForStartup } from './connectors.js';

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

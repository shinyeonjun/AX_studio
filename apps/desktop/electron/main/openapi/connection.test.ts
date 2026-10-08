import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ingestOpenApiSpec: vi.fn() }));
vi.mock('@ax-studio/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ax-studio/core')>()),
  ingestOpenApiSpec: mocks.ingestOpenApiSpec,
}));

import { hydrateOpenApiConnector } from './connection.js';

type Row = { connector: string; connected: boolean; config?: Record<string, unknown> };

function setup(row?: Row) {
  let current = row;
  const setConnector = vi.fn();
  return {
    row: () => current,
    setConnector,
    store: {
      getConnections: () => (current ? [current] : []),
      setConnection: (connector: string, connected: boolean) => { current = { connector, connected }; },
    },
  };
}

describe('restoring an OpenAPI connection at startup', () => {
  it('installs the connector from the saved spec', async () => {
    const connector = { name: 'openapi' };
    mocks.ingestOpenApiSpec.mockReturnValueOnce({ connector });
    const s = setup({ connector: 'openapi', connected: true, config: { specId: 'shop', specJson: '{"openapi":"3.0.0"}', baseUrl: 'https://shop.example.com' } });
    await hydrateOpenApiConnector(s.store as never, { setConnector: s.setConnector } as never);
    expect(s.setConnector).toHaveBeenCalledWith('openapi', connector);
    expect(s.row()?.connected).toBe(true);
  });

  it('marks the connection off when the saved spec is unusable instead of failing startup', async () => {
    mocks.ingestOpenApiSpec.mockImplementationOnce(() => { throw new Error('bad spec'); });
    const broken = setup({ connector: 'openapi', connected: true, config: { specId: 'shop', specJson: '{}', baseUrl: 'https://shop.example.com' } });
    await hydrateOpenApiConnector(broken.store as never, { setConnector: broken.setConnector } as never);
    expect(broken.row()?.connected).toBe(false);

    const unreadable = setup({ connector: 'openapi', connected: true, config: { nothing: true } });
    await hydrateOpenApiConnector(unreadable.store as never, { setConnector: unreadable.setConnector } as never);
    expect(unreadable.row()?.connected).toBe(false);
    expect(unreadable.setConnector).not.toHaveBeenCalled();
  });

  it('does nothing when OpenAPI is not connected', async () => {
    const s = setup();
    await hydrateOpenApiConnector(s.store as never, { setConnector: s.setConnector } as never);
    expect(s.setConnector).not.toHaveBeenCalled();
  });
});

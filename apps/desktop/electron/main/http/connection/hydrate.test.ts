import { afterEach, describe, expect, it, vi } from 'vitest';

const discovery = vi.hoisted(() => ({
  run: vi.fn(),
  secrets: vi.fn(),
}));

vi.mock('@ax-studio/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ax-studio/core')>();
  return { ...actual, discoverHttpReadOperations: discovery.run };
});

vi.mock('./secrets.js', () => ({ readHttpSecrets: discovery.secrets }));

import { hydrateHttpConnector } from './hydrate.js';

describe('hydrateHttpConnector', () => {
  afterEach(() => vi.resetAllMocks());

  it('discovers read operations once for a legacy HTTP connection and persists the result', async () => {
    discovery.secrets.mockResolvedValue({});
    discovery.run.mockResolvedValue([{ path: 'products', label: 'Products' }]);
    const config = { endpoints: [{
      id: 'dummyjson', baseUrl: 'https://dummyjson.com/', authType: 'none',
    }] };
    const store = {
      getConnections: () => [{ connector: 'http', connected: true, config }],
      setConnection: vi.fn(),
    };
    const runtime = { setConnector: vi.fn() };

    await hydrateHttpConnector(store as never, runtime as never);

    expect(discovery.run).toHaveBeenCalledExactlyOnceWith('https://dummyjson.com/', { type: 'none' });
    expect(store.setConnection).toHaveBeenCalledWith('http', true, expect.objectContaining({
      endpoints: [expect.objectContaining({
        id: 'dummyjson',
        discoveredReadOperations: [{ path: 'products', label: 'Products' }],
      })],
    }));
    expect(runtime.setConnector).toHaveBeenCalledOnce();
  });

  it('does not rediscover endpoints that already have a catalog, including an empty one', async () => {
    discovery.secrets.mockResolvedValue({});
    const config = { endpoints: [{
      id: 'dummyjson', baseUrl: 'https://dummyjson.com/', authType: 'none', discoveredReadOperations: [],
    }] };
    const store = {
      getConnections: () => [{ connector: 'http', connected: true, config }],
      setConnection: vi.fn(),
    };

    await hydrateHttpConnector(store as never, { setConnector: vi.fn() } as never);

    expect(discovery.run).not.toHaveBeenCalled();
  });

  it('leaves failed discovery retryable instead of persisting an empty catalog', async () => {
    discovery.secrets.mockResolvedValue({});
    discovery.run.mockRejectedValue(new Error('temporary network failure'));
    const config = { endpoints: [{
      id: 'dummyjson', baseUrl: 'https://dummyjson.com/', authType: 'none',
    }] };
    const store = {
      getConnections: () => [{ connector: 'http', connected: true, config }],
      setConnection: vi.fn(),
    };

    await hydrateHttpConnector(store as never, { setConnector: vi.fn() } as never);

    expect(store.setConnection).toHaveBeenCalledWith('http', true, expect.objectContaining({
      endpoints: [expect.not.objectContaining({ discoveredReadOperations: [] })],
    }));
  });

  it('applies discovery results to the latest endpoint list instead of a stale snapshot', async () => {
    discovery.secrets.mockResolvedValue({});
    const initial = { endpoints: [{ id: 'one', baseUrl: 'https://one.example.com/', authType: 'none' }] };
    const added = { endpoints: [
      ...initial.endpoints,
      { id: 'two', baseUrl: 'https://two.example.com/', authType: 'none', discoveredReadOperations: [] },
    ] };
    let current: Record<string, unknown> = initial;
    discovery.run.mockImplementation(async () => {
      current = added; // a concurrent connect finished while discovery was running
      return [{ path: 'items', label: 'Items' }];
    });
    const store = {
      getConnections: () => [{ connector: 'http', connected: true, config: current }],
      setConnection: vi.fn(),
    };

    await hydrateHttpConnector(store as never, { setConnector: vi.fn() } as never);

    expect(store.setConnection).toHaveBeenLastCalledWith('http', true, expect.objectContaining({
      endpoints: [
        expect.objectContaining({ id: 'one', discoveredReadOperations: [{ path: 'items', label: 'Items' }] }),
        expect.objectContaining({ id: 'two' }),
      ],
    }));
  });
});

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  writeSecrets: vi.fn(async () => undefined),
}));

vi.mock('@ax-studio/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@ax-studio/core')>(),
  probeHttpBaseUrl: mocks.probe,
}));
vi.mock('./secrets.js', () => ({ readHttpSecrets: async () => ({}), writeHttpSecrets: mocks.writeSecrets }));

import { validateAndConnectHttp } from './connect.js';

function store() {
  return { getConnections: () => [], setConnection: vi.fn() };
}

describe('connecting an HTTP server that answers 401', () => {
  it('asks for credentials when none were given, and saves nothing', async () => {
    mocks.probe.mockResolvedValue({ ok: true, status: 401 });
    const target = store();
    await expect(validateAndConnectHttp(target as never, {} as never, { baseUrl: 'https://api.example.com', authType: 'none' } as never))
      .rejects.toThrow('인증이 필요해요');
    expect(target.setConnection).not.toHaveBeenCalled();
    expect(mocks.writeSecrets).not.toHaveBeenCalled();
  });

  it('says the given credentials were refused', async () => {
    mocks.probe.mockResolvedValue({ ok: true, status: 401 });
    await expect(validateAndConnectHttp(store() as never, {} as never, { baseUrl: 'https://api.example.com', authType: 'bearer', token: 'wrong' } as never))
      .rejects.toThrow('받아들이지 않았어요');
  });
});

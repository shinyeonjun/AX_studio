import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ secrets: null as string | null }));
vi.mock('../../credential-store.js', () => ({
  getOsSecret: vi.fn(async () => mocks.secrets),
  setOsSecret: vi.fn(),
  deleteOsSecret: vi.fn(),
}));

import { summarizeConnection } from './summary.js';

describe('connection cards say when a connection needs attention', () => {
  it('passes on why Gmail, HTTP and a database need reconnecting', async () => {
    const reason = '저장된 연결 정보를 읽을 수 없어요. 설정에서 다시 연결해 주세요.';
    expect(await summarizeConnection('gmail', false, { lastError: reason })).toMatchObject({ lastError: reason });
    expect(await summarizeConnection('http', false, { lastError: reason })).toMatchObject({ lastError: reason });
    expect(await summarizeConnection('rdb', false, { lastError: reason })).toMatchObject({ lastError: reason });
  });

  it('marks an API whose saved login is gone as needing reconnect, and does not count it as connected', async () => {
    const config = { endpoints: [
      { id: 'open', baseUrl: 'https://open.example.com/', authType: 'none' },
      { id: 'shop', baseUrl: 'https://shop.example.com/', authType: 'bearer', authStored: true },
    ] };
    mocks.secrets = JSON.stringify({});
    const summary = await summarizeConnection('http', true, config) as { connected: boolean; endpoints: Array<{ id: string; needsReconnect?: boolean }> };
    expect(summary.endpoints.find((endpoint) => endpoint.id === 'shop')?.needsReconnect).toBe(true);
    expect(summary.endpoints.find((endpoint) => endpoint.id === 'open')?.needsReconnect).toBeUndefined();
    expect(summary.connected).toBe(true);

    const onlyShop = { endpoints: [config.endpoints[1]] };
    expect(await summarizeConnection('http', true, onlyShop)).toMatchObject({ connected: false });
  });
});

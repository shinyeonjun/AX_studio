import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AxCommandService } from '../../service.js';

describe('AxCommandService HTTP catalog', () => {
  it('pages all HTTP connections without changing selection semantics or exposing URL secrets', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', true, { endpoints: Array.from({ length: 57 }, (_, i) => ({
        id: `endpoint-${i}`, label: `Warehouse ${i}`, baseUrl: `https://user:secret@example.test/api/${i}?token=secret`, authType: 'none',
      })) });
      const service = new AxCommandService(store);
      const page = await service.execute({ name: 'http.list' });
      expect(JSON.stringify(page).length).toBeLessThan(6_000);
      expect(page.data).toMatchObject({ count: 57, nextOffset: 20, truncated: true, requiresExplicitConnectionId: true });
      const last = await service.execute({ name: 'http.list', args: { offset: 40 } });
      expect(last.data).toMatchObject({ connections: expect.arrayContaining([expect.objectContaining({ id: 'endpoint-56' })]), truncated: false });
      const selected = await service.execute({ name: 'http.list', args: { query: 'Warehouse 56' } });
      expect(selected.data).toMatchObject({ connections: [{ id: 'endpoint-56' }], requiresExplicitConnectionId: true });
      const resources = await service.execute({ name: 'resource.list' });
      expect(JSON.stringify(resources).includes('secret')).toBe(false);
      expect(JSON.stringify(resources).length).toBeLessThan(10_000);
      expect((await service.execute({ name: 'http.list', args: { offset: -1 } })).status).toBe('invalid');
    } finally { db.close?.(); }
  });

  it('lists every saved HTTP endpoint with explicit selection metadata and no credentials', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        {
          id: 'default',
          label: 'GitHub',
          baseUrl: 'https://api.github.com/',
          authType: 'none',
        },
        {
          id: 'test',
          label: '테스트 REST',
          baseUrl: 'http://127.0.0.1:4820/',
          authType: 'bearer',
          authStored: true,
          token: 'bearer-token-must-not-leak',
          password: 'password-must-not-leak',
        },
        {
          id: 'secure',
          label: '보호된 API',
          baseUrl: 'https://api-user:base-password@example.com/v1?api_key=query-secret',
          authType: 'apiKey',
          authStored: false,
          authHeader: 'X-API-Key',
          token: 'api-key-must-not-leak',
        },
      ],
    });
    const service = new AxCommandService(store);

    const response = await service.execute({ name: 'http.list' });

    expect(response).toMatchObject({
      command: 'http.list',
      status: 'ok',
      data: {
        count: 3,
        requiresExplicitConnectionId: true,
        connections: [
          {
            id: 'default',
            label: 'GitHub',
            baseUrl: 'https://api.github.com/',
            authType: 'none',
            authStored: false,
            authReady: true,
            connected: true,
            usable: true,
          },
          {
            id: 'test',
            label: '테스트 REST',
            baseUrl: 'http://127.0.0.1:4820/',
            authType: 'bearer',
            authStored: true,
            authReady: true,
            connected: true,
            usable: true,
          },
          {
            id: 'secure',
            label: '보호된 API',
            baseUrl: 'https://example.com/v1',
            authType: 'apiKey',
            authStored: false,
            authReady: false,
            connected: true,
            usable: false,
          },
        ],
      },
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('bearer-token-must-not-leak');
    expect(serialized).not.toContain('password-must-not-leak');
    expect(serialized).not.toContain('api-key-must-not-leak');
    expect(serialized).not.toContain('base-password');
    expect(serialized).not.toContain('query-secret');
  });
});

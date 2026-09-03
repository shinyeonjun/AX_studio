import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';

describe('AxCommandService HTTP catalog', () => {
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

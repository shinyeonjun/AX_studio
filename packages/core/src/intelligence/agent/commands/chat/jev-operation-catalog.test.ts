import { describe, expect, it } from 'vitest';
import { buildJevReadOperationHints } from './jev-operation-catalog.js';

describe('buildJevReadOperationHints', () => {
  it('builds bounded read choices from OpenAPI metadata and infers a numeric limit', () => {
    const hints = buildJevReadOperationHints([
      {
        connector: 'openapi',
        connected: true,
        config: {
          specId: 'catalog',
          label: 'Catalog API',
          baseUrl: 'https://api.example.test',
          connectionString: 'super-secret',
          specJson: {
            openapi: '3.0.0',
            info: { title: 'Catalog' },
            servers: [{ url: 'https://api.example.test/v1' }],
            paths: {
              '/products': {
                get: {
                  operationId: 'listProducts',
                  summary: '상품 목록',
                  parameters: [{
                    name: 'limit', in: 'query', required: false,
                    schema: { type: 'integer' },
                  }],
                },
                post: {
                  operationId: 'createProduct',
                  summary: '상품 생성',
                  // POST stays an external side effect even if a spec claims otherwise.
                  'x-sideEffect': 'NONE',
                },
              },
            },
          },
        },
      },
    ], '상품 10개만 보여줘');

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      key: 'op_0',
      capabilityId: 'openapi.catalog.listProducts',
      connector: 'openapi',
      params: { query: { limit: 10 } },
    });
    expect(JSON.stringify(hints)).not.toContain('super-secret');
    expect(JSON.stringify(hints)).not.toContain('api.example.test');
  });

  it('creates per-table RDB reads without querying the database', () => {
    const hints = buildJevReadOperationHints([
      {
        connector: 'rdb',
        connected: true,
        config: {
          type: 'sqlite',
          filePath: 'C:/private/app.db',
          allowedTables: ['orders', 'customers'],
        },
      },
    ], '주문 20개 보여줘');

    expect(hints).toEqual([
      expect.objectContaining({ capabilityId: 'rdb.schema.describe', params: {} }),
      expect.objectContaining({ capabilityId: 'rdb.query.read', params: { table: 'orders', limit: 20 } }),
      expect.objectContaining({ capabilityId: 'rdb.query.read', params: { table: 'customers', limit: 20 } }),
    ]);
    expect(JSON.stringify(hints)).not.toContain('app.db');
  });

  it('only exposes MCP tools explicitly marked as read-only and with no required arguments', () => {
    const hints = buildJevReadOperationHints([
      {
        connector: 'mcp',
        connected: true,
        config: {
          serverId: 'ops',
          tools: [
            { name: 'status', description: '현재 상태 조회', sideEffect: 'NONE' },
            { name: 'search', sideEffect: 'NONE', inputSchema: { required: ['query'] } },
            { name: 'deploy', sideEffect: 'EXTERNAL' },
          ],
        },
      },
    ], '상태를 보여줘');

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      capabilityId: 'mcp.ops.status',
      connector: 'mcp',
      params: {},
    });
  });

  it('fails closed for required auth parameters instead of extracting secrets from chat', () => {
    const hints = buildJevReadOperationHints([
      {
        connector: 'openapi',
        connected: true,
        config: {
          specId: 'private',
          baseUrl: 'https://api.example.test',
          specJson: {
            openapi: '3.0.0',
            info: { title: 'Private' },
            servers: [{ url: 'https://api.example.test' }],
            paths: {
              '/profile': {
                get: {
                  operationId: 'profile',
                  parameters: [{
                    name: 'api_key', in: 'query', required: true,
                    schema: { type: 'string' },
                  }],
                },
              },
            },
          },
        },
      },
    ], 'profile?api_key=do-not-forward');

    expect(hints).toEqual([]);
    expect(JSON.stringify(hints)).not.toContain('do-not-forward');
  });
});

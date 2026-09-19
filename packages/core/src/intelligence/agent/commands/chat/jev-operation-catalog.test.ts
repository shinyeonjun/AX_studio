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

  it('exposes read-only MCP tools and records safe argument contracts', () => {
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

    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatchObject({
      capabilityId: 'mcp.ops.status',
      connector: 'mcp',
      params: {},
    });
    expect(hints[1]).toMatchObject({
      capabilityId: 'mcp.ops.search',
      parameterHints: [{ path: 'query', required: true }],
      missingParameterPaths: ['query'],
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

  it('keeps a safe read operation available when a non-secret required value needs filling', () => {
    const hints = buildJevReadOperationHints([
      {
        connector: 'openapi',
        connected: true,
        config: {
          specId: 'orders',
          baseUrl: 'https://api.example.test',
          specJson: {
            openapi: '3.0.0',
            info: { title: 'Orders' },
            servers: [{ url: 'https://api.example.test' }],
            paths: {
              '/orders/{orderId}': {
                get: {
                  operationId: 'getOrder',
                  parameters: [{
                    name: 'orderId', in: 'path', required: true,
                    schema: { type: 'string' },
                  }],
                },
              },
            },
          },
        },
      },
    ], '주문 상세를 조회해줘');

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      capabilityId: 'openapi.orders.getOrder',
      params: {},
      parameterHints: [{ path: 'pathParams.orderId', type: 'string', required: true }],
      missingParameterPaths: ['pathParams.orderId'],
    });
  });
});

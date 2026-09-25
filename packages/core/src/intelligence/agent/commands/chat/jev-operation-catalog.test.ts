import { describe, expect, it } from 'vitest';
import {
  buildJevReadOperationHints,
  buildJevReadOperationIndex,
} from '../../../decision/read-operation-catalog.js';

describe('buildJevReadOperationHints', () => {
  it('offers naturally described HTTP reads from the service-advertised operation catalog', () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'http',
      connected: true,
      config: { endpoints: [{
        id: 'dummyjson',
        baseUrl: 'https://dummyjson.com/',
        label: 'DummyJSON',
        authType: 'none',
        discoveredReadOperations: [
          { path: 'products', label: 'Products' },
          { path: 'carts', label: 'Carts' },
        ],
      }] },
    }]).select('DummyJSON에서 상품 5개만 가져와서 이름과 가격을 보여줘');

    expect(selection.hints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        connector: 'http',
        sourceLabel: 'DummyJSON',
        label: 'DummyJSON: Products',
        params: { method: 'GET', path: 'products', connectionId: 'dummyjson' },
        parameterHints: [expect.objectContaining({ path: 'query.limit', choices: [5] })],
      }),
    ]));
    expect(JSON.stringify(selection.hints)).not.toContain('dummyjson.com');
  });

  it('offers Korean numeric literals as Jev choices instead of treating every number as a limit', () => {
    const selection = buildJevReadOperationIndex([{
      connector: 'http',
      connected: true,
      config: { endpoints: [{
        id: 'dummyjson',
        baseUrl: 'https://dummyjson.com/',
        label: 'DummyJSON',
        authType: 'none',
        discoveredReadOperations: [{ path: 'products', label: 'Products' }],
      }] },
    }]).select('DummyJSON에서 상품 5개를 가져와 이름, 가격, 재고를 표로 보여줘.');

    expect(selection.hints).toContainEqual(expect.objectContaining({
      label: 'DummyJSON: Products',
      params: { method: 'GET', path: 'products', connectionId: 'dummyjson' },
      parameterHints: [expect.objectContaining({
        path: 'query.limit',
        type: 'integer',
        required: false,
        choices: [5],
      })],
    }));
  });

  it('offers OpenAPI numeric literals for Jev to interpret as limit values', () => {
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
      sourceLabel: 'Catalog API',
      label: 'Catalog API: 상품 목록',
      params: {},
      parameterHints: [expect.objectContaining({ path: 'query.limit', choices: [10] })],
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
      expect.objectContaining({ capabilityId: 'rdb.query.read', params: { table: 'orders' }, parameterHints: [expect.objectContaining({ path: 'limit', choices: [20] })] }),
      expect.objectContaining({ capabilityId: 'rdb.query.read', params: { table: 'customers' }, parameterHints: [expect.objectContaining({ path: 'limit', choices: [20] })] }),
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
            { name: 'refresh_cache', sideEffect: 'REVERSIBLE' },
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

  it('marks missing required values and parses explicitly named path values', () => {
    const connection = {
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
                }, {
                  name: 'limit', in: 'query', required: true,
                  schema: { type: 'integer' },
                }],
              },
            },
          },
        },
      },
    } as const;
    const missing = buildJevReadOperationHints([connection], '주문 상세를 조회해줘');
    const explicit = buildJevReadOperationHints([connection], '주문 상세 orderId=order-7을 조회해줘');
    const fractional = buildJevReadOperationHints([connection], '주문 상세 orderId=order-7 limit=1.5를 조회해줘');

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      capabilityId: 'openapi.orders.getOrder',
      params: {},
      parameterHints: [
        { path: 'pathParams.orderId', type: 'string', required: true },
        { path: 'query.limit', type: 'integer', required: true },
      ],
      missingParameterPaths: ['pathParams.orderId', 'query.limit'],
    });
    expect(explicit).toHaveLength(1);
    expect(explicit[0]).toMatchObject({
      capabilityId: 'openapi.orders.getOrder',
      params: { pathParams: { orderId: 'order-7' } },
      missingParameterPaths: ['query.limit'],
    });
    expect(fractional[0]).toMatchObject({
      capabilityId: 'openapi.orders.getOrder',
      params: { pathParams: { orderId: 'order-7' } },
      missingParameterPaths: ['query.limit'],
    });
  });

  it('retains only bounded scalar enums and rejects explicit values outside the schema', () => {
    const connection = {
      connector: 'openapi',
      connected: true,
      config: {
        specId: 'orders',
        baseUrl: 'https://api.example.test',
        specJson: {
          openapi: '3.0.0',
          info: { title: 'Orders' },
          servers: [{ url: 'https://api.example.test' }],
          paths: { '/orders': { get: {
            operationId: 'listOrders',
            parameters: [{ name: 'status', in: 'query', required: true, schema: { type: 'string', enum: ['paid', 'pending'] } }],
          } } },
        },
      },
    } as const;
    const selected = buildJevReadOperationIndex([connection]).select('status=paid 주문 조회').hints[0];
    const invalid = buildJevReadOperationIndex([connection]).select('status=cancelled 주문 조회').hints[0];

    expect(selected).toMatchObject({
      params: { query: { status: 'paid' } },
      missingParameterPaths: [],
      parameterHints: [{ path: 'query.status', choices: ['paid', 'pending'] }],
    });
    expect(invalid).toMatchObject({
      params: {},
      missingParameterPaths: ['query.status'],
      parameterHints: [{ path: 'query.status', choices: ['paid', 'pending'] }],
    });
  });

  it('offers the full provider-compatible catalog to Jev instead of a lexical shortlist', () => {
    const tables = [...Array.from({ length: 69 }, (_, index) => `table_${index}`), '재고'];
    const index = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: { type: 'sqlite', allowedTables: tables },
    }]);

    const selection = index.select('재고 5개 보여줘');

    expect(selection.totalCount).toBe(71);
    expect(selection.catalogMayBeBounded).toBe(false);
    expect(selection.mode).toBe('full_catalog');
    expect(selection.lexicalMatchedOperationCount).toBe(1);
    expect(selection.lexicalTopScore).toBe(1);
    expect(selection.hints).toHaveLength(71);
    expect(selection.hints.at(-1)).toMatchObject({
      capabilityId: 'rdb.query.read',
      params: { table: '재고' },
      parameterHints: [expect.objectContaining({ path: 'limit', choices: [5] })],
    });
  });

  it('lets Jev resolve a lexical miss from the complete catalog when it fits', () => {
    const tables = Array.from({ length: 70 }, (_, index) => `table_${index}`);
    const index = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: { type: 'sqlite', allowedTables: tables },
    }]);
    const selection = index.select('재고를 보여줘');

    expect(selection.hints).toHaveLength(71);
    expect(selection.mode).toBe('full_catalog');
    expect(selection.catalogMayBeBounded).toBe(false);
    expect(selection.lexicalMatchedOperationCount).toBe(0);
    expect(selection.lexicalTopScore).toBe(0);
  });

  it('does not exceed Jev’s hard choice limit when a lexical miss has a larger catalog', () => {
    const tables = Array.from({ length: 254 }, (_, index) => `table_${index}`);
    const index = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: { type: 'sqlite', allowedTables: tables },
    }]);
    const selection = index.select('재고를 보여줘');

    expect(selection.totalCount).toBe(255);
    expect(selection.hints).toHaveLength(255);
    expect(selection.mode).toBe('no_lexical_match');
    expect(selection.catalogMayBeBounded).toBe(false);
  });

  it('resolves request-specific limits after selecting from a cached index', () => {
    const index = buildJevReadOperationIndex([{
      connector: 'rdb',
      connected: true,
      config: { type: 'sqlite', allowedTables: ['products'] },
    }]);

    const selection = index.select('products 5개 보여줘');
    expect(selection.mode).toBe('full_catalog');
    expect(selection.lexicalMatchedOperationCount).toBe(1);
    expect(selection.lexicalTopScore).toBe(1);
    expect(selection.hints.find((hint) => hint.params.table === 'products'))
      .toMatchObject({ params: { table: 'products' }, parameterHints: [{ path: 'limit', choices: [5] }] });
    expect(index.select('products 2개 보여줘').hints.find((hint) => hint.params.table === 'products'))
      .toMatchObject({ parameterHints: [{ path: 'limit', choices: [2] }] });
  });

  it('indexes connected Gmail and Slack reads without exposing connection secrets', () => {
    const index = buildJevReadOperationIndex([
      { connector: 'gmail', connected: true, config: { refreshToken: 'gmail-secret' } },
      { connector: 'slack', connected: true, config: { token: 'slack-secret' } },
    ]);

    expect(index.select('Gmail 최근 메일 5개 보여줘').hints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: 'gmail.messages.search',
        params: {},
        parameterHints: [{ path: 'limit', type: 'integer', required: false, choices: [5] }],
      }),
    ]));
    expect(index.select('Slack에서 재고라는 단어가 포함된 메시지를 찾아줘').hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'slack.messages.search', params: { query: '재고' } }),
    ]));
    expect(JSON.stringify(index.select('Gmail 메일과 Slack 메시지를 조회해줘').hints)).not.toContain('secret');
  });

  it('offers local spreadsheet reads from connected folders and binds only an explicitly named file', () => {
    const index = buildJevReadOperationIndex([{
      connector: 'local_folder',
      connected: true,
      config: {
        folders: [
          { id: 'sales-folder', label: '매출 자료', path: 'C:/private/sales', addedAt: '' },
          { id: 'ops-folder', label: '운영 자료', path: 'C:/private/ops', addedAt: '' },
        ],
      },
    }]);

    const unresolved = index.select('시트 데이터를 읽어줘').hints
      .filter((hint) => hint.capabilityId === 'local_sheet.read');
    expect(unresolved).toHaveLength(2);
    expect(unresolved[0]).toMatchObject({
      sourceLabel: '매출 자료',
      params: { folderId: 'sales-folder' },
      missingParameterPaths: ['path'],
    });

    const fileLists = index.select('폴더 파일 5개 보여줘 offset=10').hints
      .filter((hint) => hint.capabilityId === 'local_folder.list');
    expect(fileLists).toHaveLength(2);
    expect(fileLists[0]).toMatchObject({
      params: { folderId: 'sales-folder', offset: 10 },
      parameterHints: [{ path: 'limit', choices: [5] }],
    });

    const selected = index.select('path="2026 매출.xlsx" sheet=Q2 표로 보여줘').hints
      .filter((hint) => hint.capabilityId === 'local_sheet.read');
    expect(selected).toHaveLength(2);
    expect(selected[0]).toMatchObject({
      params: { folderId: 'sales-folder', path: '2026 매출.xlsx', sheet: 'Q2' },
      missingParameterPaths: [],
    });
    expect(JSON.stringify(selected)).not.toContain('C:/private');
  });

  it('extracts a bounded search term from ordinary Korean relevance wording', () => {
    const index = buildJevReadOperationIndex([
      { connector: 'gmail', connected: true, config: {} },
      { connector: 'slack', connected: true, config: {} },
    ]);

    expect(index.select('최근 7일 동안 재고 관련 메일을 찾아줘').hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'gmail.messages.search', params: { query: '재고' } }),
    ]));
    expect(index.select('최근 7일 동안 재고 관련 메시지를 찾아줘').hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'slack.messages.search', params: { query: '재고' }, missingParameterPaths: [] }),
    ]));
  });

  it('resolves required MCP scalar parameters only when named in the request', () => {
    const index = buildJevReadOperationIndex([{
      connector: 'mcp',
      connected: true,
      config: {
        serverId: 'ops',
        tools: [{
          name: 'search',
          sideEffect: 'NONE',
          inputSchema: {
            type: 'object',
            required: ['query', 'limit'],
            properties: { query: { type: 'string' }, limit: { type: 'integer' } },
          },
        }],
      },
    }]);

    expect(index.select('query=inventory limit=5로 검색해줘').hints).toEqual([
      expect.objectContaining({
        capabilityId: 'mcp.ops.search',
        params: { query: 'inventory', limit: 5 },
        missingParameterPaths: [],
      }),
    ]);
    expect(index.select('재고를 검색해줘').hints).toEqual([
      expect.objectContaining({
        capabilityId: 'mcp.ops.search',
        params: {},
        missingParameterPaths: ['query', 'limit'],
      }),
    ]);
  });

  it('normalizes search parameters for OpenAPI, MCP, and Slack without consuming adjacent arguments', () => {
    const index = buildJevReadOperationIndex([
      {
        connector: 'openapi',
        connected: true,
        config: {
          specId: 'inventory',
          baseUrl: 'https://api.example.test',
          specJson: {
            openapi: '3.0.0',
            info: { title: 'Inventory' },
            servers: [{ url: 'https://api.example.test' }],
            paths: {
              '/items': {
                get: {
                  operationId: 'searchItems',
                  parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
                },
              },
            },
          },
        },
      },
      {
        connector: 'mcp', connected: true,
        config: { serverId: 'ops', tools: [{ name: 'search', sideEffect: 'NONE',
          inputSchema: { required: ['query'], properties: { query: { type: 'string' } } } }] },
      },
      { connector: 'slack', connected: true, config: {} },
    ]);

    const natural = index.select('재고 관련 상품 조회').hints;
    expect(natural).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'openapi.inventory.searchItems', params: { query: { q: '재고' } } }),
      expect.objectContaining({ capabilityId: 'mcp.ops.search', params: { query: '재고' }, missingParameterPaths: [] }),
      expect.objectContaining({ capabilityId: 'slack.messages.search', params: { query: '재고' }, missingParameterPaths: [] }),
    ]));

    expect(index.select('Slack query=inventory limit=5로 검색해줘').hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'slack.messages.search', params: { query: 'inventory', limit: 5 } }),
    ]));
  });
});

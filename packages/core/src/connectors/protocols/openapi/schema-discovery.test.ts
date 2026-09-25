import { describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignTool } from '../../../intelligence/design-tools/index.js';
import { parseOpenApiSpec } from './parse.js';

const SPEC = {
  openapi: '3.0.0',
  info: { title: '주문 조회 API', version: '1.0.0' },
  servers: [{ url: 'https://user:password@example.test/api?token=secret' }],
  paths: {
    '/orders': {
      get: {
        operationId: 'listOrders',
        summary: '주문 목록 조회',
        parameters: [
          { name: 'month', in: 'query', required: true, description: '조회 월', schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['paid', 'pending'] } },
        ],
        responses: {
          '200': {
            description: '주문 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orders: {
                      type: 'array',
                      description: '주문 배열',
                      items: { type: 'object' },
                    },
                    total: { type: 'number', description: '총 주문 수' },
                  },
                  required: ['orders'],
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createOrder',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  customerId: { type: 'string', description: '고객 식별자' },
                  amount: { type: 'number', description: '결제 금액' },
                },
                required: ['customerId', 'amount'],
              },
            },
          },
        },
        responses: { '201': { description: '생성 완료' } },
      },
    },
  },
};

describe('OpenAPI schema discovery', () => {
  it('extracts bounded operation and field contracts without retaining the raw spec', () => {
    const spec = parseOpenApiSpec('orders', SPEC);
    expect(spec.operations).toMatchObject([
      {
        operationId: 'listOrders',
        parameters: [
          { name: 'month', in: 'query', required: true, type: 'string' },
          { name: 'status', in: 'query', required: false, type: 'string', enum: ['paid', 'pending'] },
        ],
        responses: [{ status: '200', fields: [
          { name: 'orders', type: 'array', required: true },
          { name: 'total', type: 'number', required: false },
        ] }],
      },
      {
        operationId: 'createOrder',
        requestBody: {
          required: true,
          contentTypes: ['application/json'],
          fields: [
            { name: 'customerId', type: 'string', required: true },
            { name: 'amount', type: 'number', required: true },
          ],
        },
      },
    ]);
  });

  it('describes a selected OpenAPI asset without probing the endpoint or exposing credentials', async () => {
    const fetchSpy = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('network must not be called'); }) as typeof fetch;
    try {
      const ctx = buildDesignToolContext(
        [{
          connector: 'openapi',
          connected: true,
          config: {
            specId: 'orders',
            label: '주문 API',
            baseUrl: 'https://user:password@example.test/api?token=secret',
            specJson: SPEC,
          },
        }],
        ['openapi'],
      );
      const result = await executeDesignTool(
        { tool: 'discovery.describe', args: { assetId: 'openapi:orders', depth: 'schema' } },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        asset: {
          id: 'openapi:orders',
          kind: 'http_endpoint',
          access: 'mixed',
          provenance: { source: 'openapi', ref: 'openapi:orders' },
          lineage: [{ relationship: 'provided_by', assetId: 'connector:openapi' }],
        },
        details: {
          available: true,
          api: { id: 'orders', title: '주문 조회 API', baseUrl: 'https://example.test/api' },
          totalOperations: 2,
        },
      });
      const details = (result.data as { details: { operations: unknown[] } }).details;
      expect(details.operations).toEqual(expect.arrayContaining([expect.objectContaining({
        id: 'openapi.orders.listOrders',
        operationId: 'listOrders',
        method: 'GET',
        path: '/orders',
        summary: '주문 목록 조회',
        sideEffect: 'NONE',
        parameters: [
          { name: 'month', description: '조회 월', in: 'query', required: true, type: 'string' },
          { name: 'status', in: 'query', required: false, type: 'string', enum: ['paid', 'pending'] },
        ],
      })]));
      const serialized = JSON.stringify(result.data);
      expect(serialized).not.toContain('user:password');
      expect(serialized).not.toContain('token=secret');
    } finally {
      globalThis.fetch = fetchSpy;
    }
  });
});

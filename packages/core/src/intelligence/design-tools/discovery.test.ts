import { describe, expect, it, vi } from 'vitest';
import { buildDesignToolContext, buildDiscoveryAssetIndex, executeDesignTool } from './index.js';
import type { Connector } from '../../connectors/types.js';

function context(overrides: Record<string, unknown> = {}) {
  return buildDesignToolContext(
    [
      {
        connector: 'rdb',
        connected: true,
        config: {
          type: 'postgres',
          connectionString: 'postgres://user:password@localhost:5432/ax?token=secret',
          allowedTables: ['public.customers', 'orders'],
        },
      },
      {
        connector: 'http',
        connected: true,
        config: {
          endpoints: [
            {
              id: 'orders-api',
              label: '주문 API',
              baseUrl: 'https://user:password@example.test/api?token=secret',
              authType: 'bearer',
              authStored: true,
            },
          ],
        },
      },
      {
        connector: 'local_folder',
        connected: true,
        config: {
          folders: [{ id: 'reports', label: '보고서 자료', path: 'D:/private/reports' }],
        },
      },
    ],
    ['rdb', 'http', 'local_folder', 'document'],
    overrides,
  );
}

describe('design-tools discovery', () => {
  it('reuses the discovery snapshot within a tool turn', () => {
    const ctx = context();
    expect(buildDiscoveryAssetIndex(ctx)).toBe(buildDiscoveryAssetIndex(ctx));
  });

  it('pages a large selected business dictionary without losing later fields', async () => {
    const ctx = context({ discoveryMetadata: [{
      assetId: 'rdb:public.customers', aliases: [], updatedAt: '2026-09-06T00:00:00Z',
      fields: Array.from({ length: 100 }, (_, i) => ({ name: `field${i}`, description: 'd'.repeat(500) })),
    }] });
    const first = await executeDesignTool({ tool: 'discovery.describe', args: { assetId: 'rdb:public.customers' } }, ctx);
    expect(JSON.stringify(first.data).length).toBeLessThan(8_000);
    expect(first.data).toMatchObject({ fieldPage: { total: 100, nextOffset: 8, truncated: true } });
    const last = await executeDesignTool({ tool: 'discovery.describe', args: { assetId: 'rdb:public.customers', offset: 96 } }, ctx);
    expect(last.data).toMatchObject({ asset: { fields: expect.arrayContaining([{ name: 'field99', description: 'd'.repeat(500) }]) }, fieldPage: { total: 100, truncated: false } });
  });

  it('keeps summary reads compact and makes later OpenAPI operations reachable', async () => {
    const schema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 50 }, (_, i) =>
      [`field${i}`, { type: 'string', description: 'large-schema-detail'.repeat(10) }])) };
    const ctx = buildDesignToolContext([{ connector: 'openapi', connected: true, config: {
      specId: 'catalog', baseUrl: 'https://example.test', specJson: { openapi: '3.0.0', info: { title: 'Catalog', version: '1' },
        servers: [{ url: 'https://example.test' }], paths: Object.fromEntries(Array.from({ length: 65 }, (_, i) =>
          [`/records/${i}`, { get: { operationId: `record${i}`, responses: { '200': {
            description: 'ok', content: { 'application/json': { schema } },
          } } } }])) },
    } }], ['openapi']);
    const summary = await executeDesignTool({ tool: 'discovery.describe', args: { assetId: 'openapi:catalog' } }, ctx);
    expect(summary.ok).toBe(true);
    expect(JSON.stringify(summary.data).includes('large-schema-detail')).toBe(false);
    expect(JSON.stringify(summary.data).length).toBeLessThan(12_000);
    const later = await executeDesignTool({ tool: 'discovery.describe', args: { assetId: 'openapi:catalog', offset: 60, limit: 5 } }, ctx);
    expect(later.data).toMatchObject({ details: { operations: expect.arrayContaining([
      expect.objectContaining({ operationId: 'record60' }),
    ]) } });
  });

  it('indexes configured data and tools without exposing secrets or physical paths', async () => {
    const httpResult = await executeDesignTool(
      { tool: 'discovery.search', args: { query: '주문' } },
      context(),
    );
    const dbResult = await executeDesignTool(
      { tool: 'discovery.search', args: { query: 'customers' } },
      context(),
    );

    expect(httpResult.ok).toBe(true);
    expect(dbResult.ok).toBe(true);
    const serialized = JSON.stringify({ http: httpResult.data, db: dbResult.data });
    expect(serialized).toContain('http:orders-api');
    expect(serialized).toContain('rdb:public.customers');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('user:password');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('D:/private/reports');
    expect(serialized).not.toContain('metadata');
  });

  it('describes a tool contract without invoking it', async () => {
    const result = await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'tool:rdb.query.read' } },
      context(),
    );

    expect(result).toMatchObject({ ok: true });
    expect(result.data).toMatchObject({
      asset: { id: 'tool:rdb.query.read', kind: 'tool' },
      details: {
        available: true,
        capability: {
          id: 'rdb.query.read',
          kind: 'read',
          connector: 'rdb',
        },
      },
    });
  });

  it('uses persisted business metadata only after the asset is selected', async () => {
    const result = await executeDesignTool(
      { tool: 'discovery.search', args: { query: '결제 금액', kind: 'database_table' } },
      context({
        discoveryMetadata: [{
          assetId: 'rdb:public.customers',
          description: '고객 결제 원장',
          aliases: [],
          fields: [{ name: 'amount', label: '결제 금액', description: '주문 총액' }],
          updatedAt: '2026-09-05T00:00:00.000Z',
        }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ candidates: [{ id: 'rdb:public.customers' }] });
    expect(JSON.stringify(result.data)).not.toContain('주문 총액');

    const described = await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'rdb:public.customers' } },
      context({
        discoveryMetadata: [{
          assetId: 'rdb:public.customers',
          description: '고객 결제 원장',
          aliases: ['결제 금액'],
          fields: [{ name: 'amount', label: '결제 금액', description: '주문 총액' }],
          updatedAt: '2026-09-05T00:00:00.000Z',
        }],
      }),
    );
    expect(described.data).toMatchObject({
      asset: {
        description: '고객 결제 원장',
        fields: [{ name: 'amount', description: '주문 총액' }],
        provenance: { source: 'connection', ref: 'connection:rdb' },
        lineage: [{ relationship: 'provided_by', assetId: 'connector:rdb' }],
      },
    });
  });

  it('describes an HTTP endpoint with a sanitized base URL only', async () => {
    const result = await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'http:orders-api' } },
      context(),
    );

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.data);
    expect(serialized).toContain('https://example.test/api');
    expect(serialized).not.toContain('user:password');
    expect(serialized).not.toContain('token=secret');
  });

  it('reads only bounded table schema on explicit schema depth', async () => {
    const execute = vi.fn(async (action: string, params: Record<string, unknown>) => ({
      ok: true,
      data: { action, table: params.table, columns: [{ name: 'id', type: 'integer' }] },
    }));
    const rdb: Connector = { name: 'rdb', execute };

    const summary = await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'rdb:public.customers' } },
      context({ connectors: { rdb } }),
    );
    expect(summary.ok).toBe(true);
    expect(execute).not.toHaveBeenCalled();

    const schema = await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'rdb:public.customers', depth: 'schema' } },
      context({ connectors: { rdb } }),
    );
    expect(schema.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith('table.describe', { table: 'public.customers', offset: 0, limit: 8 }, expect.any(Object));
    expect(schema.data).toMatchObject({
      details: {
        available: true,
        schema: { columns: [{ name: 'id', type: 'integer' }] },
      },
    });
    await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'rdb:public.customers', depth: 'schema', offset: 20, limit: 5 } },
      context({ connectors: { rdb } }),
    );
    expect(execute).toHaveBeenLastCalledWith('table.describe', { table: 'public.customers', offset: 20, limit: 5 }, expect.any(Object));
  });

  it('rejects invalid filters and unknown asset ids at the design-tool boundary', async () => {
    const invalid = await executeDesignTool(
      { tool: 'discovery.search', args: { query: '고객', kind: 'arbitrary' } },
      context(),
    );
    expect(invalid).toMatchObject({ ok: false, error: 'kind_invalid' });

    const missing = await executeDesignTool(
      { tool: 'discovery.describe', args: { assetId: 'rdb:missing' } },
      context(),
    );
    expect(missing).toMatchObject({ ok: false, error: 'discovery_asset_not_found' });
  });
});

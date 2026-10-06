import { describe, expect, it } from 'vitest';
import { buildHttpResponseArtifact, httpResponseToTable } from './http-response.js';

function response(body: string, truncated = false) {
  return buildHttpResponseArtifact({
    executionId: 'exec-http-test',
    url: 'http://test.local/orders',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body,
    truncated,
  });
}

describe('HttpResponseArtifact', () => {
  it('converts a root JSON array into a complete table', () => {
    const result = httpResponseToTable(
      response('[{"id":"order-1","amount":100},{"id":"order-2","amount":200}]'),
      { sourceId: 'orders' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.table.rows).toHaveLength(2);
      expect(result.table.rows[0]?.values).toEqual({ id: 'order-1', amount: 100 });
      expect(result.table.completeness).toMatchObject({ status: 'complete', hasMore: false });
      expect(result.table.source).toMatchObject({ queryFingerprint: expect.stringMatching(/^http_/) });
    }
  });

  it('requires an explicit path for nested rows and preserves response truncation', () => {
    const nested = response('{"orders":[{"id":"order-1","status":"paid"}]}');
    expect(httpResponseToTable(nested, { sourceId: 'orders' })).toEqual({
      ok: false,
      errorCode: 'http_rows_path_required',
    });

    const result = httpResponseToTable(
      response('[{"id":"order-1"},{"id":"order-2"},{"id":"order-3"}]', true),
      { sourceId: 'orders', rowLimit: 2 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.table.rows).toHaveLength(2);
      expect(result.table.truncated).toBe(true);
      expect(result.table.completeness).toEqual({
        status: 'partial',
        reason: 'response_byte_limit',
        observedCount: 2,
        limit: 2,
        hasMore: true,
      });
    }
  });

  it('reads nested rows only from the requested path', () => {
    const result = httpResponseToTable(
      response('{"data":{"orders":[{"id":"order-1","amount":"1,000"}]}}'),
      { sourceId: 'orders', rowsPath: 'data.orders' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.table.rows[0]?.values).toEqual({ id: 'order-1', amount: 1000 });
  });

  it('keeps nested JSON fields readable when an HTTP response becomes a table', () => {
    const result = httpResponseToTable(
      response('[{"id":1,"dimensions":{"width":10,"height":20},"tags":["fragile","keep dry"]}]'),
      { sourceId: 'products' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.table.rows[0]?.values).toEqual({
        id: 1,
        dimensions: '{"width":10,"height":20}',
        tags: '["fragile","keep dry"]',
      });
    }
  });

  it('marks a page from a paginated envelope as partial so rankings are not presented as complete', () => {
    const paged = httpResponseToTable(
      response('{"products":[{"id":1,"price":10},{"id":2,"price":20}],"total":194,"skip":0,"limit":2}'),
      { sourceId: 'products', rowsPath: 'products' },
    );
    expect(paged.ok && paged.table.completeness).toMatchObject({ status: 'partial', reason: 'provider_limit', observedCount: 2, hasMore: true });

    const whole = httpResponseToTable(
      response('{"products":[{"id":1},{"id":2}],"total":2}'),
      { sourceId: 'products', rowsPath: 'products' },
    );
    expect(whole.ok && whole.table.completeness).toMatchObject({ status: 'complete' });

    const flagged = httpResponseToTable(
      response('{"data":{"items":[{"id":1}],"has_more":true}}'),
      { sourceId: 'items', rowsPath: 'data.items' },
    );
    expect(flagged.ok && flagged.table.completeness?.status).toBe('partial');
  });
});

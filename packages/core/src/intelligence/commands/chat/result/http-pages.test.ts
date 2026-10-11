import { describe, expect, it } from 'vitest';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { MAX_HTTP_ROWS, nextHttpPagePath, readAllHttpPages, withAllPages } from './http-pages.js';
import { chatReadRecipe } from './read-recipe.js';

const command = (path: string): AxCommand => ({
  name: 'capability.invoke',
  args: { id: 'http.request', params: { connectionId: 'dummy', method: 'GET', path } },
} as AxCommand);

function response(body: unknown): AxCommandResult {
  return {
    status: 'ok',
    data: {
      capabilityId: 'http.request',
      data: {
        id: 'http_x', kind: 'http_response', status: 200, statusText: 'OK', headers: {}, url: 'https://example.test/products',
        body: JSON.stringify(body), truncated: false, completeness: { status: 'complete', hasMore: false },
      },
    },
  } as unknown as AxCommandResult;
}

/** A provider with `total` items served `limit` at a time from `skip`. */
function offsetProvider(total: number) {
  const requested: string[] = [];
  const read = async (next: AxCommand) => {
    const path = String((next.args as { params: { path: string } }).params.path);
    requested.push(path);
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const skip = Number(query.get('skip') ?? 0);
    const limit = 30;
    const products = Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, index) => ({ id: skip + index + 1 }));
    return response({ products, total, skip, limit });
  };
  return { requested, read };
}

describe('the next page a provider describes', () => {
  it('moves only the offset or page parameter, and stops at the end', () => {
    expect(nextHttpPagePath('products?select=title', { json: { total: 194, skip: 0, limit: 30 }, rows: Array(30).fill({}) }, 30))
      .toBe('products?select=title&skip=30');
    expect(nextHttpPagePath('items', { json: { page: 2, total_pages: 3 }, rows: [{}] }, 20)).toBe('items?page=3');
    expect(nextHttpPagePath('items', { json: { page: 3, total_pages: 3 }, rows: [{}] }, 30)).toBeUndefined();
    expect(nextHttpPagePath('products', { json: { total: 30, skip: 0 }, rows: Array(30).fill({}) }, 30)).toBeUndefined();
    // No envelope fields: no guessing.
    expect(nextHttpPagePath('products', { json: { products: [] }, rows: [{}] }, 1)).toBeUndefined();
  });
});

describe('gathering every page for a whole-set answer', () => {
  it('merges all pages into one response the table then reads whole', async () => {
    const provider = offsetProvider(194);
    const first = await provider.read(command('products'));
    const gathered = await readAllHttpPages(command('products'), first, provider.read);
    expect(gathered).toMatchObject({ pages: 7, complete: true });
    const body = JSON.parse(((gathered.result.data as { data: { body: string } }).data).body) as { products: unknown[]; skip: number; limit: number };
    expect(body.products).toHaveLength(194);
    expect(provider.requested.slice(1)).toEqual(['products?skip=30', 'products?skip=60', 'products?skip=90', 'products?skip=120', 'products?skip=150', 'products?skip=180']);
  });

  it('stops at its limits and says the data is partial', async () => {
    const provider = offsetProvider(5_000);
    const first = await provider.read(command('products'));
    const gathered = await readAllHttpPages(command('products'), first, provider.read);
    expect(gathered.complete).toBe(false);
    const data = (gathered.result.data as { data: { body: string; completeness: unknown } }).data;
    expect((JSON.parse(data.body) as { products: unknown[] }).products.length).toBeLessThanOrEqual(MAX_HTTP_ROWS);
    expect(data.completeness).toMatchObject({ status: 'partial', reason: 'provider_limit', hasMore: true });
  });

  it('leaves a single complete page, and non-GET reads, as they were', async () => {
    const single = response({ products: [{ id: 1 }], total: 1, skip: 0, limit: 30 });
    expect(await readAllHttpPages(command('products'), single, async () => { throw new Error('no second read'); }))
      .toMatchObject({ pages: 1, result: single });
    const post = { ...command('products'), args: { id: 'http.request', params: { method: 'POST', path: 'products' } } } as AxCommand;
    expect((await readAllHttpPages(post, response({ products: [{}], total: 100, skip: 0 }), async () => { throw new Error('never'); })).pages).toBe(1);
  });
});

describe('the recipe of a gathered answer', () => {
  it('asks the connector for every page, so a recurring job reads the whole set too', async () => {
    const provider = offsetProvider(194);
    const first = await provider.read(command('products'));
    const gathered = await readAllHttpPages(command('products'), first, provider.read);
    expect(chatReadRecipe(withAllPages(command('products')), gathered.result)).toMatchObject({
      kind: 'http_table', params: { path: 'products', allPages: true }, rowsPath: 'products',
    });
  });
});

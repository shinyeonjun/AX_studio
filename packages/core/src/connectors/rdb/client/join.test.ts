import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { RdbConnector } from '../connector.js';
import type { ConnectorContext } from '../../types.js';
import { summarizeRdbSchema } from './relations.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

async function shopDb(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ax-rdb-join-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, region TEXT);
    CREATE TABLE products (code TEXT PRIMARY KEY, name TEXT, category TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id TEXT, product_code TEXT, amount INTEGER, status TEXT);
    CREATE TABLE visits (customer_id TEXT, page TEXT);
    INSERT INTO customers VALUES ('c1', '가나상사', '서울'), ('c2', '다라무역', '부산');
    INSERT INTO products VALUES ('p1', '노트', '문구'), ('p2', '펜', '문구');
    INSERT INTO orders VALUES (1, 'c1', 'p1', 100, '완료'), (2, 'c2', 'p2', 200, '완료'), (3, 'c1', 'p2', 50, '취소'), (4, 'c9', 'p1', 10, '완료');
    INSERT INTO visits VALUES ('c1', '/'), ('c1', '/a');
  `);
  const filePath = join(root, 'shop.db');
  writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
  return filePath;
}

const ctx = (): ConnectorContext => ({ executionId: 'exec', variables: {}, log: () => undefined } as unknown as ConnectorContext);
const allTables = ['customers', 'products', 'orders', 'visits'];

describe('relations a connected database shows', () => {
  it('finds what each column points to by its name, confirmed by the values', async () => {
    const filePath = await shopDb();
    const summary = await summarizeRdbSchema({ type: 'sqlite', filePath, allowedTables: allTables });
    expect(summary.tables.find((table) => table.table === 'orders')).toMatchObject({
      columns: ['id', 'customer_id', 'product_code', 'amount', 'status'], uniqueColumns: ['id'],
    });
    expect(summary.relations.map(({ from, to }) => `${from.table}.${from.column} -> ${to.table}.${to.column}`)).toEqual([
      'orders.customer_id -> customers.id', 'orders.product_code -> products.code', 'visits.customer_id -> customers.id',
    ]);
  });

  it('offers nothing it cannot read: relations only between allowed tables', async () => {
    const filePath = await shopDb();
    const summary = await summarizeRdbSchema({ type: 'sqlite', filePath, allowedTables: ['orders', 'products'] });
    expect(summary.relations.map(({ to }) => to.table)).toEqual(['products']);
  });
});

describe('reading a table with the rows it points to', () => {
  it('adds the customer columns to each order without repeating or dropping orders', async () => {
    const filePath = await shopDb();
    const connector = new RdbConnector({ type: 'sqlite', filePath, allowedTables: allTables });
    const result = await connector.execute('query.read', {
      table: 'orders', join: [{ table: 'customers', on: 'customer_id', references: 'id' }],
    }, ctx());
    expect(result.ok).toBe(true);
    const data = result.data as { name: string; rows: Array<{ values: Record<string, unknown> }>; readScope: { joins?: unknown } };
    expect(data.name).toBe('orders + customers');
    expect(data.rows.map((row) => [row.values.id, row.values['customers.region']])).toEqual([[1, '서울'], [2, '부산'], [3, '서울'], [4, null]]);
    expect(data.readScope.joins).toEqual([{ table: 'customers', on: 'customer_id', references: 'id' }]);
  });

  it('refuses a join that could repeat rows, an unknown column or a table that is not allowed', async () => {
    const filePath = await shopDb();
    const connector = new RdbConnector({ type: 'sqlite', filePath, allowedTables: allTables });
    const read = (joins: unknown) => connector.execute('query.read', { table: 'orders', join: joins }, ctx());
    expect(await read([{ table: 'visits', on: 'customer_id', references: 'customer_id' }])).toMatchObject({ ok: false, error: 'join_key_not_unique' });
    expect(await read([{ table: 'customers', on: 'customer_id', references: 'nope' }])).toMatchObject({ ok: false, error: 'join_column_unknown' });
    expect(await new RdbConnector({ type: 'sqlite', filePath, allowedTables: ['orders'] }).execute('query.read',
      { table: 'orders', join: [{ table: 'customers', on: 'customer_id', references: 'id' }] }, ctx())).toMatchObject({ ok: false, error: 'table_not_allowed' });
    expect(await read([{ table: 'customers', on: 'customer_id', references: 'id', where: '1=1' }])).toMatchObject({ ok: false, error: 'invalid_join' });
  });
});

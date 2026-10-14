import { describe, expect, it } from 'vitest';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import { coveringRdbRead, rdbTablesRead, readsOfRowTable } from './rdb-read-cover.js';

const read = (key: string, table: string, joins: string[] = [], sourceLabel = '쇼핑몰 DB'): JevReadOperationHint => ({
  key, capabilityId: 'rdb.query.read', connector: 'rdb', sourceLabel, label: key, description: key,
  params: { table, ...(joins.length ? { join: joins.map((joined) => ({ table: joined, on: `${joined}_id`, references: 'id' })) } : {}) },
});
const orders = read('orders', 'orders');
const customers = read('customers', 'customers');
const products = read('products', 'products');
const ordersCustomers = read('orders+customers', 'orders', ['customers']);
const all = read('orders+customers+products', 'orders', ['customers', 'products']);
const catalog = [orders, ordersCustomers, all, customers, products];

describe('one read for tables asked about together', () => {
  it('is the smallest joined read holding every selected table', () => {
    expect(coveringRdbRead([orders, customers], catalog)).toBe(ordersCustomers);
    expect(coveringRdbRead([orders, customers, ordersCustomers], catalog)).toBe(ordersCustomers);
    expect(coveringRdbRead([orders, ordersCustomers, all], catalog)).toBe(all);
    expect(coveringRdbRead([customers, products, orders], catalog)).toBe(all);
  });

  it('is nothing when the reads are unrelated, single, or not all database reads', () => {
    expect(coveringRdbRead([customers, products], catalog)).toBeUndefined();
    expect(coveringRdbRead([orders], catalog)).toBeUndefined();
    expect(coveringRdbRead([orders, { ...customers, capabilityId: 'http.request' }], catalog)).toBeUndefined();
    expect(coveringRdbRead([orders, read('c', 'customers', [], '다른 DB')], catalog)).toBeUndefined();
  });
});

describe('the table whose records the answer is made of', () => {
  it('lists every table the selected reads touch, joined ones included', () => {
    expect(rdbTablesRead([products, read('orders+products', 'orders', ['products'])])).toEqual(['products', 'orders']);
    expect(rdbTablesRead([ordersCustomers])).toEqual(['orders', 'customers']);
    expect(rdbTablesRead([orders, { ...customers, capabilityId: 'http.request' }])).toBeUndefined();
  });

  it('keeps the reads of that table, or its plain read when only a join brought it in', () => {
    // Real: a product price list selected products and the "orders + products" join next to it.
    expect(readsOfRowTable([products, all], catalog, 'products')).toEqual([products]);
    expect(readsOfRowTable([orders, ordersCustomers, all], catalog, 'orders')).toEqual([orders, ordersCustomers, all]);
    // A customer email list selected only "orders + customers".
    expect(readsOfRowTable([ordersCustomers], catalog, 'customers')).toEqual([customers]);
    expect(readsOfRowTable([ordersCustomers], [ordersCustomers], 'customers')).toEqual([ordersCustomers]);
  });
});

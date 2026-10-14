import { describe, expect, it } from 'vitest';
import { buildJevReadOperationHints } from './read-operation-catalog.js';

const connection = (allowedTables: string[]) => ({
  connector: 'rdb',
  connected: true,
  config: {
    type: 'sqlite',
    label: '쇼핑몰 DB',
    allowedTables,
    schema: {
      tables: [
        { table: 'orders', columns: ['id', 'customer_id', 'product_code', 'amount'], uniqueColumns: ['id'] },
        { table: 'customers', columns: ['id', 'name', 'region'], uniqueColumns: ['id'] },
        { table: 'products', columns: ['code', 'category'], uniqueColumns: ['code'] },
      ],
      relations: [
        { from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' }, declared: false },
        { from: { table: 'orders', column: 'product_code' }, to: { table: 'products', column: 'code' }, declared: false },
      ],
    },
  },
});

describe('reads a connected database offers', () => {
  it('offers each table once, with the tables its keys point to as relations', () => {
    const hints = buildJevReadOperationHints([connection(['orders', 'customers', 'products'])], '지역별 매출');
    const reads = hints.filter((hint) => hint.capabilityId === 'rdb.query.read');
    expect(reads.map((hint) => hint.label)).toEqual(['DB 조회: orders', 'DB 조회: customers', 'DB 조회: products']);
    expect(reads[0]!.description).toContain('열: id, customer_id, product_code, amount');
    expect(reads[0]!.description).toContain('연결된 테이블: customers, products');
    expect(reads[0]!.params).toEqual({ table: 'orders' });
    expect(reads[0]!.relations).toEqual([
      { table: 'customers', on: 'customer_id', references: 'id', columns: ['name', 'region'] },
      { table: 'products', on: 'product_code', references: 'code', columns: ['category'] },
    ]);
    expect(reads[1]!.relations).toBeUndefined();
  });

  it('never relates a table the connection does not allow', () => {
    const hints = buildJevReadOperationHints([connection(['orders', 'products'])], '주문');
    const orders = hints.find((hint) => hint.label === 'DB 조회: orders');
    expect(orders?.relations?.map(({ table }) => table)).toEqual(['products']);
  });
});

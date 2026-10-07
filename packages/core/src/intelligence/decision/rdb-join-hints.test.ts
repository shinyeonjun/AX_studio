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
  it('names each table’s columns and offers it with the rows its keys point to', () => {
    const hints = buildJevReadOperationHints([connection(['orders', 'customers', 'products'])], '지역별 매출');
    const reads = hints.filter((hint) => hint.capabilityId === 'rdb.query.read');
    expect(reads.map((hint) => hint.label)).toEqual([
      'DB 조회: orders', 'DB 조회: orders + customers', 'DB 조회: orders + products', 'DB 조회: orders + customers + products',
      'DB 조회: customers', 'DB 조회: products',
    ]);
    expect(reads[0]!.description).toContain('열: id, customer_id, product_code, amount');
    expect(reads[1]!.description).toContain('customers의 열(name, region)');
    expect(reads[1]!.params).toEqual({ table: 'orders', join: [{ table: 'customers', on: 'customer_id', references: 'id' }] });
  });

  it('never offers a join onto a table the connection does not allow', () => {
    const hints = buildJevReadOperationHints([connection(['orders', 'products'])], '주문');
    expect(hints.map((hint) => hint.label)).not.toContain('DB 조회: orders + customers');
    expect(hints.map((hint) => hint.label)).toContain('DB 조회: orders + products');
  });
});

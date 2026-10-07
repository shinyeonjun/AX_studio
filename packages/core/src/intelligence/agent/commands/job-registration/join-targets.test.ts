import { describe, expect, it } from 'vitest';
import { workflowStepItems } from './presentation.js';

describe('a job card for a joined database read', () => {
  it('names the tables read alongside the base table', () => {
    const [item] = workflowStepItems({
      sideEffects: {},
      steps: [{
        type: 'action', id: 'read', connector: 'rdb', action: 'query.read', sideEffect: 'NONE',
        params: { table: 'orders', join: [{ table: 'customers', on: 'customer_id', references: 'id' }, { table: 'products', on: 'product_code', references: 'code' }] },
      }],
    } as never);
    expect(item).toContain('대상: 테이블 orders, 함께 읽는 테이블 customers, products');
  });
});

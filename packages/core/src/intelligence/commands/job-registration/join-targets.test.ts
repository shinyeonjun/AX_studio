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

describe('a step with no destination of its own', () => {
  it('says its input is what started the run, or an earlier step', () => {
    const items = workflowStepItems({
      sideEffects: {},
      steps: [
        { type: 'action', id: 'read', connector: 'gmail', action: 'messages.read', sideEffect: 'NONE', params: {}, bindings: { message: { from: 'trigger', output: 'message' } } },
        { type: 'action', id: 'again', connector: 'gmail', action: 'messages.read', sideEffect: 'NONE', params: {}, bindings: { message: { from: 'read', output: 'body' } } },
      ],
    } as never);
    expect(items[0]).toContain('대상: 시작 조건으로 들어온 항목');
    expect(items[1]).toContain('대상: 1단계 결과');
  });
});

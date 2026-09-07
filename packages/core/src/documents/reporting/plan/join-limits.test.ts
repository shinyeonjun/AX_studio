import { expect, it } from 'vitest';
import { executeReportPlan } from './execute.js';
import type { ReportPlan } from './schema.js';

const plan: ReportPlan = { schemaVersion: 1, baseSource: 'a',
  joins: [{ source: 'b', left: 'a.key', right: 'key', cardinality: 'many', type: 'inner' }],
  scalars: [{ id: 'n', expression: { kind: 'count' } }], tables: [], texts: [] };

it('retains numeric string and boolean equality semantics in indexed joins', () => {
  const result = executeReportPlan(plan, {
    a: { id: 'a', complete: true, rows: [{ key: '1,000' }, { key: false }, { key: '0' }] },
    b: { id: 'b', complete: true, rows: [{ key: 1000 }, { key: false }, { key: 0 }] },
  }, {});
  expect(result.scalars.n.raw).toBe(3);
});

it('rejects many-to-many expansion before it can grow without a bound', () => {
  expect(() => executeReportPlan(plan, {
    a: { id: 'a', complete: true, rows: Array.from({ length: 400 }, () => ({ key: 1 })) },
    b: { id: 'b', complete: true, rows: Array.from({ length: 400 }, () => ({ key: 1 })) },
  }, {})).toThrow('report_join_row_limit');
});

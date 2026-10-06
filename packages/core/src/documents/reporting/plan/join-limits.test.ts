import { expect, it } from 'vitest';
import { evaluateAggregate } from './aggregate.js';
import { executeReportPlan } from './execute.js';
import { formatReportValue } from './format.js';
import { compareValues } from './value.js';
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

it('never joins identifier-like text to a different number, or null keys to each other', () => {
  const result = executeReportPlan(plan, {
    a: { id: 'a', complete: true, rows: [{ key: '001' }, { key: null }, { key: '' }, { key: '1.0' }, { key: '7' }] },
    b: { id: 'b', complete: true, rows: [{ key: 1 }, { key: null }, { key: '' }, { key: 7 }] },
  }, {});
  // Only "1.0" = 1 and "7" = 7 match; "001" stays text and empty keys never match.
  expect(result.scalars.n.raw).toBe(2);
});

it('compares text equality without coercing both sides into numbers', () => {
  expect(compareValues('eq', '001', '1')).toBe(false);
  expect(compareValues('eq', '1,000', 1000)).toBe(true);
  expect(compareValues('eq', '', '')).toBe(true);
  expect(compareValues('eq', null, undefined)).toBe(true);
  expect(compareValues('gt', '1,200', '900')).toBe(true);
});

it('returns null for an empty average and handles large min/max inputs', () => {
  const rows = Array.from({ length: 200_000 }, (_, index) => ({ v: index }));
  expect(evaluateAggregate({ kind: 'average', value: { kind: 'field', path: 'v' } }, [])).toBeNull();
  expect(evaluateAggregate({ kind: 'min', value: { kind: 'field', path: 'v' } }, rows)).toBe(0);
  expect(evaluateAggregate({ kind: 'max', value: { kind: 'field', path: 'v' } }, rows)).toBe(199_999);
});

it('rounds integer format the same way as decimal format', () => {
  expect(formatReportValue(-2.5, { style: 'integer' })).toBe('-3');
  expect(formatReportValue(2.5, { style: 'integer' })).toBe('3');
  expect(formatReportValue(1234.4, { style: 'integer' })).toBe('1,234');
});

import { describe, expect, it } from 'vitest';
import { executeReportPlan } from './execute.js';
import type { ReportPlan, ReportSourceSnapshot } from './schema.js';

const sources: Record<string, ReportSourceSnapshot> = {
  orders: {
    id: 'orders',
    complete: true,
    rows: [
      { id: 'o1', customer_id: 'c1', paid_at: '2026-09-02', status: 'PAID', net: '1000', refund: '0' },
      { id: 'o2', customer_id: 'c1', paid_at: '2026-09-03', status: 'PARTIAL', net: '800', refund: '100' },
      { id: 'o3', customer_id: 'c2', paid_at: '2026-09-04', status: 'PAID', net: '600', refund: '0' },
      { id: 'o4', customer_id: 'c3', paid_at: '2026-09-05', status: 'PENDING', net: '900', refund: '0' },
    ],
  },
  customers: {
    id: 'customers',
    complete: true,
    rows: [
      { customer_id: 'c1', name: 'Acme', region: 'Seoul', manager_id: 'm1' },
      { customer_id: 'c2', name: 'Beta', region: 'Busan', manager_id: 'm2' },
      { customer_id: 'c3', name: 'Gamma', region: 'Seoul', manager_id: 'm1' },
    ],
  },
  contracts: {
    id: 'contracts',
    complete: true,
    rows: [
      { customer_id: 'c1', target: '2000', active: true },
      { customer_id: 'c2', target: '1000', active: true },
      { customer_id: 'c3', target: '1000', active: true },
    ],
  },
  managers: {
    id: 'managers',
    complete: true,
    rows: [
      { manager_id: 'm1', manager_name: 'Kim' },
      { manager_id: 'm2', manager_name: 'Lee' },
    ],
  },
};

const field = (path: string) => ({ kind: 'field' as const, path });
const literal = (value: string | number | boolean | null) => ({ kind: 'literal' as const, value });

const plan: ReportPlan = {
  schemaVersion: 1,
  baseSource: 'orders',
  joins: [
    { source: 'customers', left: 'orders.customer_id', right: 'customer_id', type: 'inner', cardinality: 'one' },
    { source: 'contracts', left: 'orders.customer_id', right: 'customer_id', type: 'inner', cardinality: 'one' },
    { source: 'managers', left: 'customers.manager_id', right: 'manager_id', type: 'left', cardinality: 'one' },
  ],
  filter: {
    kind: 'and',
    items: [
      { kind: 'in', value: field('orders.status'), values: [literal('PAID'), literal('PARTIAL')] },
      { kind: 'compare', operation: 'gte', left: field('orders.paid_at'), right: literal('2026-09-01') },
      { kind: 'compare', operation: 'lt', left: field('orders.paid_at'), right: literal('2026-10-01') },
    ],
  },
  scalars: [
    {
      id: 'recognized_revenue',
      expression: {
        kind: 'sum',
        value: { kind: 'arithmetic', operation: 'subtract', left: field('orders.net'), right: field('orders.refund') },
      },
      format: { style: 'currency', currency: 'KRW', decimals: 0 },
    },
    { id: 'recognized_orders', expression: { kind: 'count' }, format: { style: 'integer' } },
    {
      id: 'active_customers',
      expression: { kind: 'count_distinct', value: field('orders.customer_id') },
      format: { style: 'integer' },
    },
    {
      id: 'target_achievement',
      expression: {
        kind: 'arithmetic',
        operation: 'divide',
        left: { kind: 'sum', value: { kind: 'arithmetic', operation: 'subtract', left: field('orders.net'), right: field('orders.refund') } },
        right: { kind: 'sum_distinct', value: field('contracts.target'), distinctBy: field('orders.customer_id') },
      },
      format: { style: 'percent', decimals: 2 },
    },
  ],
  tables: [
    {
      kind: 'aggregate',
      id: 'customers',
      groupBy: [
        { id: 'customer_id', value: field('orders.customer_id') },
        { id: 'customer_name', value: field('customers.name') },
        { id: 'region', value: field('customers.region') },
        { id: 'manager', value: field('managers.manager_name') },
      ],
      columns: [
        { id: 'customer_id', value: { kind: 'group_key', keyId: 'customer_id' }, format: { style: 'text' } },
        { id: 'customer_name', value: { kind: 'group_key', keyId: 'customer_name' }, format: { style: 'text' } },
        { id: 'region', value: { kind: 'group_key', keyId: 'region' }, format: { style: 'text' } },
        { id: 'manager', value: { kind: 'group_key', keyId: 'manager' }, format: { style: 'text' } },
        {
          id: 'revenue',
          value: {
            kind: 'aggregate',
            expression: { kind: 'sum', value: { kind: 'arithmetic', operation: 'subtract', left: field('orders.net'), right: field('orders.refund') } },
          },
          format: { style: 'currency', currency: 'KRW', decimals: 0 },
        },
        { id: 'orders', value: { kind: 'aggregate', expression: { kind: 'count' } }, format: { style: 'integer' } },
        {
          id: 'target',
          value: { kind: 'aggregate', expression: { kind: 'first', value: field('contracts.target'), requireConsistent: true } },
          format: { style: 'currency', currency: 'KRW', decimals: 0 },
        },
        {
          id: 'achievement',
          value: {
            kind: 'aggregate',
            expression: {
              kind: 'arithmetic',
              operation: 'divide',
              left: { kind: 'sum', value: { kind: 'arithmetic', operation: 'subtract', left: field('orders.net'), right: field('orders.refund') } },
              right: { kind: 'first', value: field('contracts.target'), requireConsistent: true },
            },
          },
          format: { style: 'percent', decimals: 2 },
        },
      ],
      sort: [{ columnId: 'revenue', direction: 'desc' }],
    },
    {
      kind: 'view',
      id: 'risks',
      sourceTable: 'customers',
      filter: {
        kind: 'compare',
        operation: 'lt',
        left: { kind: 'column', columnId: 'achievement' },
        right: literal(0.8),
      },
      columns: ['customer_name', 'manager', 'achievement'],
      sort: [{ columnId: 'achievement', direction: 'asc' }],
    },
  ],
  texts: [
    { id: 'summary', kind: 'computed', template: '{{meta.periodLabel}} revenue was {{scalar.recognized_revenue}}.' },
  ],
};

describe('executeReportPlan', () => {
  it('deterministically joins, filters, aggregates, formats, and derives a risk view', () => {
    const result = executeReportPlan(plan, sources, { periodLabel: '2026-09' });

    expect(result.scalars).toMatchObject({
      recognized_revenue: { raw: 2300, display: 'KRW 2,300' },
      recognized_orders: { raw: 3, display: '3' },
      active_customers: { raw: 2, display: '2' },
      target_achievement: { raw: 2300 / 3000, display: '76.67%' },
    });
    expect(result.tables.customers.rows.map((row) => row.raw)).toEqual([
      expect.objectContaining({ customer_id: 'c1', revenue: 1700, orders: 2, target: '2000', achievement: 0.85 }),
      expect.objectContaining({ customer_id: 'c2', revenue: 600, orders: 1, target: '1000', achievement: 0.6 }),
    ]);
    expect(result.tables.risks.rows.map((row) => row.raw)).toEqual([
      { customer_name: 'Beta', manager: 'Lee', achievement: 0.6 },
    ]);
    expect(result.texts.summary).toBe('2026-09 revenue was KRW 2,300.');
  });

  it('is invariant to source row order', () => {
    const reversed = Object.fromEntries(
      Object.entries(sources).map(([id, source]) => [id, { ...source, rows: [...source.rows].reverse() }]),
    );
    expect(executeReportPlan(plan, reversed, { periodLabel: '2026-09' }))
      .toEqual(executeReportPlan(plan, sources, { periodLabel: '2026-09' }));
  });

  it('fails closed when any selected snapshot is incomplete', () => {
    expect(() => executeReportPlan(plan, {
      ...sources,
      orders: { ...sources.orders, complete: false },
    }, { periodLabel: '2026-09' })).toThrowError('report_source_incomplete:orders');
  });

  it('fails closed when a declared one-to-one join is ambiguous', () => {
    expect(() => executeReportPlan(plan, {
      ...sources,
      contracts: {
        ...sources.contracts,
        rows: [...sources.contracts.rows, { customer_id: 'c1', target: '9999', active: true }],
      },
    }, { periodLabel: '2026-09' })).toThrowError('report_join_cardinality_violation:contracts');
  });

  it('filters join candidates before enforcing one-to-one cardinality', () => {
    const activeOnly: ReportPlan = {
      ...plan,
      joins: plan.joins.map((join) => join.source === 'contracts'
        ? {
          ...join,
          where: {
            kind: 'compare', operation: 'eq',
            left: field('contracts.active'), right: literal(true),
          },
        }
        : join),
    };
    const withHistoricalContract = {
      ...sources,
      contracts: {
        ...sources.contracts,
        rows: [...sources.contracts.rows, { customer_id: 'c1', target: '9999', active: false }],
      },
    };
    expect(executeReportPlan(activeOnly, withHistoricalContract, { periodLabel: '2026-09' }))
      .toEqual(executeReportPlan(activeOnly, sources, { periodLabel: '2026-09' }));
  });

  it('accepts a source-qualified right join path without changing join semantics', () => {
    const qualified: ReportPlan = {
      ...plan,
      joins: plan.joins.map((join) => ({ ...join, right: `${join.source}.${join.right}` })),
    };
    expect(executeReportPlan(qualified, sources, { periodLabel: '2026-09' }))
      .toEqual(executeReportPlan(plan, sources, { periodLabel: '2026-09' }));
  });

  it('makes host-computed period metadata available to reusable filters', () => {
    const periodParameterized: ReportPlan = {
      ...plan,
      filter: {
        kind: 'and',
        items: [
          { kind: 'in', value: field('orders.status'), values: [literal('PAID'), literal('PARTIAL')] },
          { kind: 'compare', operation: 'gte', left: field('orders.paid_at'), right: field('meta.periodStart') },
          { kind: 'compare', operation: 'lte', left: field('orders.paid_at'), right: field('meta.periodEndInclusive') },
        ],
      },
    };

    const result = executeReportPlan(periodParameterized, sources, {
      periodLabel: '2026-09',
      periodStart: '2026-09-01',
      periodEndInclusive: '2026-09-30',
    });

    expect(result.scalars.recognized_orders?.raw).toBe(3);
  });

  it('derives categorical table cells from aggregate results without fixture mappings', () => {
    const categorized: ReportPlan = {
      ...plan,
      tables: plan.tables.map((table) => table.id !== 'customers' || table.kind !== 'aggregate'
        ? table
        : {
          ...table,
          columns: [
            ...table.columns,
            {
              id: 'review_bucket',
              value: {
                kind: 'derived' as const,
                expression: {
                  kind: 'case' as const,
                  branches: [{
                    when: {
                      kind: 'compare' as const,
                      operation: 'lt' as const,
                      left: { kind: 'column' as const, columnId: 'achievement' },
                      right: literal(0.75),
                    },
                    value: literal('review'),
                  }],
                  fallback: literal('healthy'),
                },
              },
              format: { style: 'text' as const },
            },
          ],
        }),
    };

    const result = executeReportPlan(categorized, sources, { periodLabel: 'arbitrary-period' });

    expect(result.tables.customers.rows.map((row) => ({
      customer: row.raw.customer_id,
      bucket: row.raw.review_bucket,
    }))).toEqual([
      { customer: 'c1', bucket: 'healthy' },
      { customer: 'c2', bucket: 'review' },
    ]);
  });

  it('fails closed when a derived column refers to a later or missing column', () => {
    const invalid: ReportPlan = {
      ...plan,
      tables: [{
        kind: 'aggregate',
        id: 'invalid',
        groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
        columns: [{
          id: 'bucket',
          value: {
            kind: 'derived',
            expression: { kind: 'column', columnId: 'not_declared_yet' },
          },
        }],
      }],
    };

    expect(() => executeReportPlan(invalid, sources, { periodLabel: 'arbitrary-period' }))
      .toThrow('report_derived_column_dependency_missing:invalid.bucket:not_declared_yet');
  });
});

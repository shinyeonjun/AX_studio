import { describe, expect, it } from 'vitest';
import { executeReportPlan } from './execute.js';
import { ReportPlanSchema, type ReportPlan, type ReportSourceSnapshot } from './schema.js';

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

it('ranks and limits a view by an undisplayed source column', () => {
  const plan: ReportPlan = {
    schemaVersion: 1, baseSource: 'sales', joins: [], scalars: [], texts: [],
    tables: [{
      kind: 'aggregate', id: 'customers',
      groupBy: [{ id: 'name', value: field('sales.name') }],
      columns: [
        { id: 'name', value: { kind: 'group_key', keyId: 'name' } },
        { id: 'amount', value: { kind: 'aggregate', expression: { kind: 'sum', value: field('sales.amount') } } },
      ],
    }, {
      kind: 'view', id: 'top_customer', sourceTable: 'customers', columns: ['name'],
      sort: [{ columnId: 'amount', direction: 'desc' }], limit: 1,
    }],
  };
  const result = executeReportPlan(plan, {
    sales: { id: 'sales', complete: true, rows: [{ name: 'A', amount: 1 }, { name: 'Z', amount: 100 }] },
  });
  expect(result.tables.top_customer).toEqual({
    columns: ['name'], rows: [{ raw: { name: 'Z' }, display: { name: 'Z' } }],
  });
  expect(result.tables.customers?.rows).toHaveLength(2);
});

it('computes independent report sections without multiplying contract totals by order count', () => {
  const input = {
    schemaVersion: 1, baseSource: 'orders', joins: [],
    datasets: [{ id: 'contractData', baseSource: 'contracts', joins: [] }],
    scalars: [
      { id: 'orders', expression: { kind: 'count' } },
      { id: 'contractTarget', dataset: 'contractData', expression: { kind: 'sum', value: field('contracts.target') } },
    ],
    tables: [{ kind: 'aggregate', id: 'contracts', dataset: 'contractData',
      groupBy: [{ id: 'customer', value: field('contracts.customer_id') }],
      columns: [{ id: 'customer', value: { kind: 'group_key', keyId: 'customer' } }],
    }], texts: [],
  };
  const result = executeReportPlan(input as ReportPlan, sources);
  expect(result.scalars.orders?.raw).toBe(4);
  expect(result.scalars.contractTarget?.raw).toBe(4000);
  expect(result.tables.contracts?.rows).toHaveLength(3);
  expect(() => executeReportPlan({ ...input, scalars: [
    { id: 'invalid', dataset: 'unknown', expression: { kind: 'count' } },
  ] } as ReportPlan, sources)).toThrow('report_dataset_missing:unknown');
});

it('treats the base source alias in a dataset selector as the root dataset', () => {
  const input: ReportPlan = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [{ id: 'count', dataset: 'orders', expression: { kind: 'count' } }],
    tables: [],
    texts: [],
  };

  expect(executeReportPlan(input, sources).scalars.count?.raw).toBe(4);
});

it('treats blank dataset selectors as omitted root selectors', () => {
  const input: ReportPlan = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [{ id: 'count', dataset: '  ', expression: { kind: 'count' } }],
    tables: [{
      kind: 'aggregate', id: 'summary', dataset: '',
      groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
      columns: [{ id: 'customer', value: { kind: 'group_key', keyId: 'customer' } }],
    }],
    texts: [],
  };

  const result = executeReportPlan(input, sources);
  expect(result.scalars.count?.raw).toBe(4);
  expect(result.tables.summary?.rows).toHaveLength(3);
});

it('evaluates metadata value scalars and aggregate expressions in derived table cells', () => {
  const input: ReportPlan = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [{
      id: 'period_label',
      expression: {
        kind: 'concat',
        values: [field('meta.periodLabel'), literal(' report')],
      },
    }],
    tables: [{
      kind: 'aggregate',
      id: 'summary',
      groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
      columns: [
        { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
        {
          id: 'attainment',
          value: {
            kind: 'derived',
            expression: {
              kind: 'arithmetic',
              operation: 'divide',
              left: { kind: 'sum', value: field('orders.net') },
              right: { kind: 'first', value: field('orders.net'), requireConsistent: false },
            },
          },
        },
      ],
    }],
    texts: [],
  };

  const result = executeReportPlan(input, sources, { periodLabel: 'September 2034' });

  expect(result.scalars.period_label?.raw).toBe('September 2034 report');
  expect(result.tables.summary?.rows.map((row) => row.raw.attainment)).toEqual([1.8, 1, 1]);
});

it('unwraps aggregate wrappers nested inside derived table expressions', () => {
  const input = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [],
    tables: [{
      kind: 'aggregate',
      id: 'summary',
      groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
      columns: [
        { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
        {
          id: 'attainment',
          value: {
            kind: 'derived',
            expression: {
              kind: 'arithmetic',
              operation: 'divide',
              left: {
                kind: 'aggregate',
                expression: { kind: 'sum', value: field('orders.net') },
              },
              right: {
                kind: 'aggregate',
                expression: { kind: 'first', value: field('orders.net'), requireConsistent: false },
              },
            },
          },
        },
      ],
    }],
    texts: [],
  };

  expect(executeReportPlan(ReportPlanSchema.parse(input), sources).tables.summary?.rows.map((row) => row.raw.attainment))
    .toEqual([1.8, 1, 1]);
});

it('reports an actionable error when a plan references a source without joining it', () => {
  const input: ReportPlan = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [{
      id: 'target',
      expression: { kind: 'sum', value: field('contracts.target') },
    }],
    tables: [],
    texts: [],
  };

  expect(() => executeReportPlan(input, sources))
    .toThrow('report_plan_field_source_not_joined:root.contracts');
});

  it('evaluates aggregate expressions nested in scalar prose over the full dataset', () => {
  const mixed: ReportPlan = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [{
      id: 'summary',
      expression: {
        kind: 'concat',
        values: [
          field('meta.periodLabel'),
          literal(': '),
          { kind: 'sum', value: field('orders.net') },
          literal(' / '),
          { kind: 'count' },
        ],
      },
      format: { style: 'text' },
    }],
    tables: [],
    texts: [],
  };

  const result = executeReportPlan(mixed, sources, { periodLabel: 'September 2034' });

    expect(result.scalars.summary).toEqual({ raw: 'September 2034: 3300 / 4', display: 'September 2034: 3300 / 4' });
  });

it('classifies grouped rows with aggregate expressions inside a case predicate', () => {
    const classified: ReportPlan = {
      ...plan,
      tables: [{
        kind: 'aggregate',
        id: 'classified',
        groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
        columns: [
          { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
          { id: 'revenue', value: { kind: 'aggregate', expression: { kind: 'sum', value: field('orders.net') } } },
          {
            id: 'classification',
            value: {
              kind: 'derived',
              expression: {
                kind: 'case',
                branches: [{
                  when: {
                    kind: 'compare',
                    operation: 'lt',
                    left: {
                      kind: 'arithmetic',
                      operation: 'divide',
                      left: { kind: 'sum', value: field('orders.net') },
                      right: { kind: 'first', value: field('contracts.target'), requireConsistent: true },
                    },
                    right: literal(0.75),
                  },
                  value: literal('review'),
                }],
                fallback: literal('healthy'),
              },
            },
          },
        ],
      }],
      texts: [],
    };

    expect(executeReportPlan(classified, sources).tables.classified?.rows.map((row) => row.raw)).toEqual([
      { customer: 'c1', revenue: 1800, classification: 'healthy' },
      { customer: 'c2', revenue: 600, classification: 'review' },
    ]);
  });

  it('evaluates scalar references inside grouped derived expressions', () => {
    const withScalarReference: ReportPlan = {
      ...plan,
      scalars: [{ id: 'globalRevenue', expression: { kind: 'sum', value: field('orders.net') } }],
      tables: [{
        kind: 'aggregate',
        id: 'shares',
        groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
        columns: [
          { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
          { id: 'revenue', value: { kind: 'aggregate', expression: { kind: 'sum', value: field('orders.net') } } },
          {
            id: 'share',
            value: {
              kind: 'derived',
              expression: {
                kind: 'arithmetic',
                operation: 'divide',
                left: { kind: 'column', columnId: 'revenue' },
                right: { kind: 'scalar', scalarId: 'globalRevenue' },
              },
            },
          },
        ],
      }],
      texts: [],
    };

    expect(executeReportPlan(withScalarReference, sources).tables.shares?.rows.map((row) => row.raw)).toEqual([
      { customer: 'c1', revenue: 1800, share: 0.75 },
      { customer: 'c2', revenue: 600, share: 0.25 },
    ]);
  });

  it('fails closed when a grouped cell references an unknown scalar', () => {
    const missingScalar: ReportPlan = {
      ...plan,
      tables: [{
        kind: 'aggregate',
        id: 'shares',
        groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
        columns: [{
          id: 'share',
          value: {
            kind: 'derived',
            expression: { kind: 'scalar', scalarId: 'does_not_exist' },
          },
        }],
      }],
      texts: [],
    };

    expect(() => executeReportPlan(missingScalar, sources))
      .toThrow('report_scalar_reference_missing:does_not_exist');
  });

  it('resolves grouped derived cells from hidden group keys', () => {
    const groupedLabel: ReportPlan = {
      ...plan,
      tables: [{
        kind: 'aggregate',
        id: 'labels',
        groupBy: [
          { id: 'customer_id', value: field('orders.customer_id') },
          { id: 'customer_name', value: field('customers.name') },
        ],
        columns: [{
          id: 'label',
          value: {
            kind: 'derived',
            expression: {
              kind: 'concat',
              values: [
                { kind: 'column', columnId: 'customer_id' },
                literal(': '),
                { kind: 'column', columnId: 'customer_name' },
              ],
            },
          },
        }],
      }],
      texts: [],
    };

    expect(executeReportPlan(groupedLabel, sources).tables.labels?.rows.map((row) => row.raw)).toEqual([
      { label: 'c1: Acme' },
      { label: 'c2: Beta' },
    ]);
  });

  it('does not duplicate a currency prefix supplied by the model', () => {
    const formatted: ReportPlan = {
      ...plan,
      scalars: [{
        id: 'revenue',
        expression: { kind: 'sum', value: field('orders.net') },
        format: { style: 'currency', currency: 'KRW', prefix: 'KRW ', decimals: 0 },
      }],
      tables: [],
      texts: [],
    };

    expect(executeReportPlan(formatted, sources).scalars.revenue).toEqual({
      raw: 2400,
      display: 'KRW 2,400',
    });
  });

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

  it('normalizes a copied candidate alias on a join left key to the prior row source', () => {
    const copiedCandidateAliases: ReportPlan = {
      ...plan,
      joins: [
        { ...plan.joins[0]!, left: 'customers.customer_id' },
        { ...plan.joins[1]!, left: 'contracts.customer_id' },
        plan.joins[2]!,
      ],
    };

    const result = executeReportPlan(copiedCandidateAliases, sources, { periodLabel: '2026-09' });

    expect(result.scalars).toMatchObject({
      recognized_revenue: { raw: 2300 },
      target_achievement: { raw: 2300 / 3000 },
    });
    expect(result.tables.customers.rows.map((row) => row.raw)).toEqual([
      expect.objectContaining({ customer_id: 'c1', target: '2000' }),
      expect.objectContaining({ customer_id: 'c2', target: '1000' }),
    ]);
  });

  it('normalizes a joined alias accidentally nested under the base source', () => {
    const nestedAlias: ReportPlan = {
      ...plan,
      scalars: [...plan.scalars, {
        id: 'nested_target_total',
        expression: {
          kind: 'sum_distinct',
          value: field('orders.contracts.target'),
          distinctBy: field('orders.contracts.customer_id'),
        },
      }],
    };

    expect(executeReportPlan(nestedAlias, sources, { periodLabel: '2026-09' })
      .scalars.nested_target_total?.raw).toBe(3000);
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

  it('resolves unqualified fields against the dataset base source', () => {
    const unqualified: ReportPlan = {
      schemaVersion: 1,
      baseSource: 'orders',
      joins: [],
      filter: {
        kind: 'and',
        items: [
          { kind: 'compare', operation: 'gte', left: field('paid_at'), right: literal('2026-09-01') },
          { kind: 'in', value: field('status'), values: [literal('PAID'), literal('PARTIAL')] },
        ],
      },
      scalars: [{ id: 'revenue', expression: { kind: 'sum', value: field('net') } }],
      tables: [{
        kind: 'aggregate',
        id: 'by_customer',
        groupBy: [{ id: 'customer', value: field('customer_id') }],
        columns: [
          { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
          { id: 'orders', value: { kind: 'aggregate', expression: { kind: 'count' } } },
        ],
      }],
      texts: [],
    };

    const result = executeReportPlan(unqualified, sources);

    expect(result.scalars.revenue?.raw).toBe(2400);
    expect(result.tables.by_customer?.rows.map((row) => row.raw)).toEqual([
      { customer: 'c1', orders: 2 },
      { customer: 'c2', orders: 1 },
    ]);
  });

  it('resolves unqualified join filters against the candidate source before cardinality checks', () => {
    const activeContracts: ReportPlan = {
      schemaVersion: 1,
      baseSource: 'orders',
      joins: [{
        source: 'contracts',
        left: 'orders.customer_id',
        right: 'customer_id',
        type: 'inner',
        cardinality: 'one',
        where: { kind: 'compare', operation: 'eq', left: field('active'), right: literal(true) },
      }],
      scalars: [{ id: 'orders', expression: { kind: 'count' } }],
      tables: [],
      texts: [],
    };
    const withHistoricalContract = {
      ...sources,
      contracts: {
        ...sources.contracts,
        rows: [...sources.contracts.rows, { customer_id: 'c1', target: '9999', active: false }],
      },
    };

    expect(executeReportPlan(activeContracts, withHistoricalContract).scalars.orders?.raw).toBe(4);
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

  it('normalizes single-brace report tokens emitted by the model', () => {
    const tokenPlan: ReportPlan = {
      ...plan,
      texts: [{ id: 'summary', kind: 'computed', template: '{meta.periodLabel} revenue was {scalar.recognized_revenue}.' }],
    };
    expect(executeReportPlan(tokenPlan, sources, { periodLabel: '2026-09' }).texts.summary)
      .toBe('2026-09 revenue was KRW 2,300.');
  });

  it('normalizes plural report namespaces emitted by the model', () => {
    const tokenPlan: ReportPlan = {
      ...plan,
      texts: [{ id: 'summary', kind: 'computed', template: '{{meta.periodLabel}} revenue was {{scalars.recognized_revenue}}.' }],
    };
    expect(executeReportPlan(tokenPlan, sources, { periodLabel: '2026-09' }).texts.summary)
      .toBe('2026-09 revenue was KRW 2,300.');
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

it('filters grouped results with an aggregate having predicate before sorting and limiting', () => {
  const filtered: ReportPlan = {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [],
    scalars: [],
    tables: [{
      kind: 'aggregate',
      id: 'at-risk',
      groupBy: [{ id: 'customer', value: field('orders.customer_id') }],
      columns: [
        { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
        { id: 'attainment', value: {
          kind: 'derived',
          expression: {
            kind: 'arithmetic',
            operation: 'divide',
            left: { kind: 'sum', value: field('orders.net') },
            right: { kind: 'first', value: field('orders.net'), requireConsistent: false },
          },
        } },
      ],
      having: {
        kind: 'compare',
        operation: 'lt',
        left: { kind: 'column', columnId: 'attainment' },
        right: literal(1.5),
      },
      sort: [{ columnId: 'attainment', direction: 'desc' }],
      limit: 1,
    }],
    texts: [],
  };

  expect(executeReportPlan(filtered, sources).tables['at-risk']?.rows.map((row) => row.raw))
    .toEqual([{ customer: 'c2', attainment: 1 }]);
});

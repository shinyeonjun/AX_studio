import { describe, expect, it } from 'vitest';
import type { InvestigationRunRequest, InvestigationRunner } from '../../../intelligence/agent/investigation-runner.js';
import { zodToCodexJsonSchema } from '../../../intelligence/agent/model/cli-json.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ReportPlanResult } from '../plan/execute.js';
import type { ReportSourceSnapshot } from '../plan/schema.js';
import { assertReportPlanTableCoverage, describeReportReplayMismatches, inferReportFormats, mergeReportBusinessInference, pruneUnboundReportTexts, ReportPlanner, repairExamplePeriodExpressions, repairExamplePresentationBindings, repairExampleReplayInference, repairExampleScalarBindings, repairExampleTextBindings, repairExampleTextFragments, repairReportDatasetReferences, repairReportFieldAliases, repairReportLayoutBindings, repairReportMetadataReferences, repairReportMetadataTextReferences, repairReportMissingJoins, repairReportScalarBindings, repairReportSourceAliases, repairReportTableCapacities, repairStaticDerivedTableLabels, repairStaticTextBindingConflicts } from './planner.js';
import { ReportBusinessInferenceSchema, ReportSourceRequirementsSchema } from './schema.js';

const pair: PdfReportPairAnalysis = {
  schemaVersion: 1,
  pairId: 'pair',
  templateHash: 'template',
  exampleHash: 'example',
  pageCount: 1,
  pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
  scalarSlots: [{
    id: 'period', pageIndex: 0, rect: { x: 1, y: 1, width: 20, height: 10 },
    exampleText: '2026년 8월', fontSize: 10, font: 'Fixture', color: 0,
  }],
  tableGroups: [],
  templateImages: ['C:\\host-only\\template.png'],
  exampleImages: ['C:\\host-only\\example.png'],
};

it('does not persist an invalid planning response across retries', async () => {
  let calls = 0;
  const runner: InvestigationRunner = {
    providerName: 'fixture',
    async run<T>() {
      calls += 1;
      return { output: (calls === 1
        ? { schemaVersion: 1, requirements: [{ invalid: true }] }
        : { schemaVersion: 1, requirements: [] }) as T };
    },
  };
  const saved = new Map<string, unknown>();
  const stage = async <T>(name: string, input: unknown, run: () => Promise<T>): Promise<T> => {
    const key = JSON.stringify([name, input]);
    if (saved.has(key)) return saved.get(key) as T;
    const value = await run();
    saved.set(key, value);
    return value;
  };
  const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) }).forExecution(stage);
  const input = { goal: 'report', pair, connectedConnectors: ['http'] };
  await expect(planner.inferSourceRequirements(input)).rejects.toThrow();
  await expect(planner.inferSourceRequirements(input)).resolves.toEqual([]);
  expect(calls).toBe(2);
});

function fakeRunner(seen: Array<InvestigationRunRequest<unknown>>): InvestigationRunner {
  return {
    providerName: 'fixture',
    async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request as InvestigationRunRequest<unknown>);
      const captureOutput = {
          schemaVersion: 1,
          requirementBindings: [],
          examplePeriod: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' },
          targetPeriod: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' },
          capturePlan: {
            schemaVersion: 1,
            http: [{
              alias: 'orders', connectionId: 'orders-api', path: '/api/v1/orders', rowsPath: 'data',
              ...(request.logContext === 'report-source-refinement' ? {
                dateQuery: { fromParam: 'from', toParam: 'to' },
                pagination: {
                  pageParam: 'page', sizeParam: 'size', pageSize: 100,
                  totalPagesPath: 'meta.total_pages', maxPages: 100,
                },
              } : {}),
            }],
            rdb: [],
          },
        };
      const output = request.logContext === 'report-source-plan' || request.logContext === 'report-source-refinement'
        ? captureOutput
        : {
          schemaVersion: 1,
          reportPlan: {
            schemaVersion: 1,
            baseSource: 'orders',
            joins: [],
            scalars: [{ id: 'orderCount', expression: { kind: 'count' }, format: { style: 'integer' } }],
            tables: [],
            texts: [],
          },
          layout: {
            schemaVersion: 1,
            outputFileName: 'report-{{meta.periodYear}}-{{meta.periodMonthPadded}}.pdf',
            scalarBindings: [{ slotId: 'period', value: { kind: 'metadata', key: 'periodLabel' } }],
            tableBindings: [],
          },
        };
      const selected = 'reportPlan' in output
        ? request.logContext?.startsWith('report-layout')
          ? { schemaVersion: 1, layout: output.layout }
          : { schemaVersion: 1, reportPlan: output.reportPlan }
        : output;
      return { output: request.outputSchema.parse(request.logContext === 'report-source-plan'
        ? { schemaVersion: 1, status: 'planned', plan: selected } : selected) };
    },
  };
}

describe('ReportPlanner', () => {
  it('repairs uniquely owned joined fields that a model attached to the fact alias', () => {
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [{ source: 'customers', left: 'orders.customer_id', right: 'customer_id', type: 'left' as const, cardinality: 'one' as const }],
      scalars: [{ id: 'customer_name', expression: field('orders.customer_name') }],
      tables: [{ kind: 'aggregate' as const, id: 'customers', groupBy: [{ id: 'customer', value: field('orders.customer_name') }],
        columns: [{ id: 'customer', value: { kind: 'group_key' as const, keyId: 'customer' } }] }],
      texts: [],
    };
    const repaired = repairReportFieldAliases(plan, {
      orders: { id: 'orders', complete: true, rows: [{ customer_id: 'C1', net_amount: 10 }] },
      customers: { id: 'customers', complete: true, rows: [{ customer_id: 'C1', customer_name: 'A' }] },
    });
    expect(repaired.scalars[0]?.expression).toEqual(field('customers.customer_name'));
    expect((repaired.tables[0] as { groupBy: Array<{ value: unknown }> }).groupBy[0]?.value)
      .toEqual(field('customers.customer_name'));

    const nested = repairReportFieldAliases({ ...plan, scalars: [{ id: 'manager', expression: field('orders.account_managers.name') }] }, {
      orders: { id: 'orders', complete: true, rows: [{ customer_id: 'C1' }] },
      customers: { id: 'customers', complete: true, rows: [{ customer_id: 'C1' }] },
      account_managers: { id: 'account_managers', complete: true, rows: [{ account_manager_id: 'AM-01', name: 'B' }] },
    });
    expect(nested.scalars[0]?.expression).toEqual(field('account_managers.name'));
  });

  it('leaves a joined field unchanged when ownership is ambiguous', () => {
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [
        { source: 'customers', left: 'orders.customer_id', right: 'customer_id', type: 'left' as const, cardinality: 'one' as const },
        { source: 'accounts', left: 'orders.account_id', right: 'account_id', type: 'left' as const, cardinality: 'one' as const },
      ],
      scalars: [{ id: 'label', expression: { kind: 'field' as const, path: 'orders.label' } }], tables: [], texts: [],
    };
    const repaired = repairReportFieldAliases(plan, {
      orders: { id: 'orders', complete: true, rows: [{ customer_id: 'C1', account_id: 'A1' }] },
      customers: { id: 'customers', complete: true, rows: [{ customer_id: 'C1', label: 'customer' }] },
      accounts: { id: 'accounts', complete: true, rows: [{ account_id: 'A1', label: 'account' }] },
    });
    expect(repaired.scalars[0]?.expression).toEqual({ kind: 'field', path: 'orders.label' });
  });

  it('adds a uniquely inferred optional join for a referenced captured source', () => {
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [{ source: 'customers', left: 'orders.customer_id', right: 'customer_id', type: 'left' as const, cardinality: 'one' as const }],
      scalars: [{ id: 'manager', expression: { kind: 'field' as const, path: 'account_managers.name' } }],
      tables: [],
      texts: [],
    };
    const repaired = repairReportMissingJoins(plan, {
      orders: { id: 'orders', complete: true, rows: [{ customer_id: 'C1', net_amount: 10 }] },
      customers: { id: 'customers', complete: true, rows: [{ customer_id: 'C1', account_manager_id: 'AM-01' }] },
      account_managers: { id: 'account_managers', complete: true, rows: [{ account_manager_id: 'AM-01', name: '김하늘' }] },
    });
    expect(repaired.joins).toHaveLength(2);
    expect(repaired.joins[1]).toMatchObject({
      source: 'account_managers',
      left: 'customers.account_manager_id',
      right: 'account_manager_id',
      type: 'left',
      cardinality: 'one',
    });
  });

  it('does not infer a join when two candidate relationships are equally plausible', () => {
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [
        { source: 'customers', left: 'orders.customer_id', right: 'customer_id', type: 'left' as const, cardinality: 'one' as const },
        { source: 'accounts', left: 'orders.account_id', right: 'account_id', type: 'left' as const, cardinality: 'one' as const },
      ],
      scalars: [{ id: 'manager', expression: { kind: 'field' as const, path: 'account_managers.name' } }],
      tables: [],
      texts: [],
    };
    const repaired = repairReportMissingJoins(plan, {
      orders: { id: 'orders', complete: true, rows: [{ customer_id: 'C1', account_id: 'A1' }] },
      customers: { id: 'customers', complete: true, rows: [{ customer_id: 'C1', manager_id: 'M1' }] },
      accounts: { id: 'accounts', complete: true, rows: [{ account_id: 'A1', manager_id: 'M1' }] },
      account_managers: { id: 'account_managers', complete: true, rows: [{ manager_id: 'M1', name: '김하늘' }] },
    });
    expect(repaired.joins).toHaveLength(2);
  });

  it('turns a static risk label into a runtime case tied to the table threshold', () => {
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'risk', groupBy: [{ id: 'customer', value: { kind: 'field' as const, path: 'orders.customer_id' } }],
        having: { kind: 'compare' as const, operation: 'lt' as const, left: { kind: 'column' as const, columnId: 'attainment' }, right: { kind: 'literal' as const, value: 0.6 } },
        columns: [{ id: 'customer', value: { kind: 'group_key' as const, keyId: 'customer' } },
          { id: 'attainment', value: { kind: 'derived' as const, expression: { kind: 'literal' as const, value: '성과 검토' } } }],
      }], texts: [],
    };
    const repaired = repairStaticDerivedTableLabels(plan);
    expect(repaired.tables[0]).toMatchObject({
      columns: [{ id: 'customer' }, { id: 'attainment', value: { kind: 'derived', expression: {
        kind: 'case', branches: [{ when: plan.tables[0]!.having }], fallback: { kind: 'literal', value: '성과 검토' },
      } } }],
    });
  });

  it('caps bound result tables to template row capacity for future periods', () => {
    const capacityPair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'summary-group', columnCount: 1, rowCount: 2,
        rows: [0, 1].map(index => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [{
          id: `summary-${index}`, pageIndex: 0,
          rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 },
          exampleText: String(index), fontSize: 8, font: 'Fixture', color: 0,
        }] })),
      }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [
        { kind: 'aggregate' as const, id: 'summary', groupBy: [{ id: 'key', value: { kind: 'field' as const, path: 'ledger.key' } }],
          columns: [{ id: 'key', value: { kind: 'group_key' as const, keyId: 'key' } }], limit: 10_000 },
        { kind: 'aggregate' as const, id: 'unbound', groupBy: [{ id: 'key', value: { kind: 'field' as const, path: 'ledger.key' } }],
          columns: [{ id: 'key', value: { kind: 'group_key' as const, keyId: 'key' } }], limit: 1 },
      ], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [{ groupId: 'summary-group', tableId: 'summary', columns: [{ columnIndex: 0, columnId: 'key' }] }],
    };

    const repaired = repairReportTableCapacities(plan, layout, capacityPair);
    expect(repaired.tables.find(table => table.id === 'summary')?.limit).toBe(2);
    expect(repaired.tables.find(table => table.id === 'unbound')?.limit).toBe(1);
  });

  it('repairs replayable ratios and top-N ordering from generic example evidence', () => {
    const replayPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, id: 'rate-slot', exampleText: '1.03%' }],
      tableGroups: [
        {
          id: 'sales-group', columnCount: 2, rowCount: 3,
          rows: ['A', 'B', 'C'].map((name, index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
            { id: `sales-${name}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: name, fontSize: 8, font: 'Fixture', color: 0 },
            { id: `sales-value-${name}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: String({ A: 90, B: 80, C: 50 }[name as 'A' | 'B' | 'C']), fontSize: 8, font: 'Fixture', color: 0 },
          ] })),
        },
        {
          id: 'risk-group', columnCount: 3, rowCount: 3,
          rows: ['A', 'B', 'C'].map((name, index) => ({ index, pageIndex: 0, y: 60 + index * 10, cells: [
            { id: `risk-${name}`, pageIndex: 0, rect: { x: 1, y: 60 + index * 10, width: 20, height: 8 }, exampleText: name, fontSize: 8, font: 'Fixture', color: 0 },
            { id: `risk-attainment-${name}`, pageIndex: 0, rect: { x: 22, y: 60 + index * 10, width: 20, height: 8 }, exampleText: ({ A: '45.00%', B: '40.00%', C: '50.00%' } as Record<string, string>)[name], fontSize: 8, font: 'Fixture', color: 0 },
            { id: `risk-rate-${name}`, pageIndex: 0, rect: { x: 43, y: 60 + index * 10, width: 20, height: 8 }, exampleText: ({ A: '1.11%', B: '2.00%', C: '0.00%' } as Record<string, string>)[name], fontSize: 8, font: 'Fixture', color: 0 },
          ] })),
        },
      ],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const aggregate = (path: string) => ({ kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field(path) } });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [],
      scalars: [{ id: 'rate', expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
        left: { kind: 'sum' as const, value: field('ledger.refund') }, right: { kind: 'sum' as const, value: field('ledger.gross') } }, format: { style: 'percent' as const, decimals: 2 } }],
      tables: [
        { kind: 'aggregate' as const, id: 'sales', groupBy: [{ id: 'entity', value: field('ledger.entity') }], columns: [
          { id: 'entity', value: { kind: 'group_key' as const, keyId: 'entity' } },
          { id: 'sales', value: aggregate('ledger.net') },
        ], sort: [{ columnId: 'sales', direction: 'desc' as const }] },
        { kind: 'aggregate' as const, id: 'risk', groupBy: [{ id: 'entity', value: field('ledger.entity') }],
          having: { kind: 'compare' as const, operation: 'lt' as const, left: { kind: 'column' as const, columnId: 'attainment' }, right: { kind: 'literal' as const, value: 0.6 } },
          sort: [{ columnId: 'attainment', direction: 'asc' as const }], limit: 3, columns: [
            { id: 'entity', value: { kind: 'group_key' as const, keyId: 'entity' } },
            { id: 'attainment', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
              left: { kind: 'sum' as const, value: field('ledger.net') }, right: { kind: 'sum' as const, value: field('ledger.target') } } }, format: { style: 'percent' as const, decimals: 2 } },
            { id: 'refund_rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
              left: { kind: 'sum' as const, value: field('ledger.refund') }, right: { kind: 'sum' as const, value: field('ledger.gross') } } }, format: { style: 'percent' as const, decimals: 2 } },
          ] },
      ], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'rate-slot', value: { kind: 'scalar' as const, id: 'rate' } }],
      tableBindings: [
        { groupId: 'sales-group', tableId: 'sales', columns: [{ columnIndex: 0, columnId: 'entity' }, { columnIndex: 1, columnId: 'sales' }] },
        { groupId: 'risk-group', tableId: 'risk', columns: [{ columnIndex: 0, columnId: 'entity' }, { columnIndex: 1, columnId: 'attainment' }, { columnIndex: 2, columnId: 'refund_rate' }] },
      ],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: replayPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { entity: 'A', gross: 100, discount: 10, net: 90, refund: 1, target: 200 },
        { entity: 'B', gross: 100, discount: 0, net: 80, refund: 2, target: 200 },
        { entity: 'C', gross: 100, discount: 0, net: 50, refund: 0, target: 100 },
      ] } },
      metadata: { periodLabel: 'example' },
    });
    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables.find((table) => table.id === 'risk')).toMatchObject({ sort: [{ columnId: 'sales', direction: 'desc' }] });
    expect(repaired.plan.tables.find((table) => table.id === 'risk')).toHaveProperty('columns', expect.arrayContaining([
      expect.objectContaining({ id: 'sales' }),
    ]));
  });

  it('repairs ratios with filtered denominators and uses an overlapping sibling metric for hidden ordering', () => {
    const variantPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, id: 'ratio-slot', exampleText: '1.96%' }],
      tableGroups: [
        {
          id: 'overview-group', columnCount: 2, rowCount: 2,
          rows: ['Y', 'X'].map((account, index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
            { id: `overview-${account}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: account, fontSize: 8, font: 'Fixture', color: 0 },
            { id: `overview-volume-${account}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: account === 'Y' ? '80' : '20', fontSize: 8, font: 'Fixture', color: 0 },
          ] })),
        },
        {
          id: 'alert-group', columnCount: 2, rowCount: 2,
          rows: ['Y', 'X'].map((account, index) => ({ index, pageIndex: 0, y: 50 + index * 10, cells: [
            { id: `alert-${account}`, pageIndex: 0, rect: { x: 1, y: 50 + index * 10, width: 20, height: 8 }, exampleText: account, fontSize: 8, font: 'Fixture', color: 0 },
            { id: `alert-rate-${account}`, pageIndex: 0, rect: { x: 22, y: 50 + index * 10, width: 20, height: 8 }, exampleText: account === 'Y' ? '1.23%' : '4.76%', fontSize: 8, font: 'Fixture', color: 0 },
          ] })),
        },
      ],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const sum = (path: string) => ({ kind: 'sum' as const, value: field(path) });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger2', joins: [],
      scalars: [{ id: 'ratio', expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
        left: sum('ledger2.rebate'), right: { kind: 'arithmetic' as const, operation: 'subtract' as const,
          left: sum('ledger2.gross'), right: sum('ledger2.rebate') } }, format: { style: 'percent' as const, decimals: 2 } }],
      tables: [
        { kind: 'aggregate' as const, id: 'overview', groupBy: [{ id: 'account', value: field('ledger2.account') }], columns: [
          { id: 'account', value: { kind: 'group_key' as const, keyId: 'account' } },
          { id: 'volume', value: { kind: 'aggregate' as const, expression: sum('ledger2.net') } },
        ], sort: [{ columnId: 'volume', direction: 'desc' as const }] },
        { kind: 'aggregate' as const, id: 'alerts', groupBy: [{ id: 'accountLabel', value: { kind: 'concat' as const, values: [field('ledger2.account'), { kind: 'literal' as const, value: '' }] } }],
          columns: [
            { id: 'accountLabel', value: { kind: 'group_key' as const, keyId: 'accountLabel' } },
            { id: 'rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
              left: sum('ledger2.rebate'), right: { kind: 'arithmetic' as const, operation: 'subtract' as const,
                left: sum('ledger2.gross'), right: sum('ledger2.rebate') } } }, format: { style: 'percent' as const, decimals: 2 } },
          ], sort: [{ columnId: 'rate', direction: 'desc' as const }], limit: 2 },
      ], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'ratio-slot', value: { kind: 'scalar' as const, id: 'ratio' } }],
      tableBindings: [
        { groupId: 'overview-group', tableId: 'overview', columns: [{ columnIndex: 0, columnId: 'account' }, { columnIndex: 1, columnId: 'volume' }] },
        { groupId: 'alert-group', tableId: 'alerts', columns: [{ columnIndex: 0, columnId: 'accountLabel' }, { columnIndex: 1, columnId: 'rate' }] },
      ],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: variantPair,
      sources: { ledger2: { id: 'ledger2', complete: true, rows: [
        { account: 'X', gross: 50, net: 20, rebate: 1 },
        { account: 'Y', gross: 50, net: 80, rebate: 1 },
      ] } }, metadata: {},
    });
    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables.find((table) => table.id === 'alerts')).toMatchObject({ sort: [{ columnId: 'volume', direction: 'desc' }] });
  });

  it('applies an evidenced sibling filter to both sides of a scalar ratio', () => {
    const ratioPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, id: 'refund-rate', exampleText: '3.83%' }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const eligible = {
      kind: 'in' as const,
      value: field('orders.status'),
      values: [
        { kind: 'literal' as const, value: 'PAID' },
        { kind: 'literal' as const, value: 'PARTIALLY_REFUNDED' },
      ],
    };
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [],
      scalars: [
        { id: 'recognized-sales', expression: { kind: 'sum' as const, value: field('orders.net'), where: eligible } },
        { id: 'refund-rate', expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
          left: { kind: 'sum' as const, value: field('orders.refund') },
          right: { kind: 'sum' as const, value: field('orders.gross') } },
          format: { style: 'percent' as const, decimals: 2 } },
      ],
      tables: [],
      texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan,
      layout: {
        schemaVersion: 1,
        outputFileName: 'report.pdf',
        scalarBindings: [{ slotId: 'refund-rate', value: { kind: 'scalar', id: 'refund-rate' } }],
        tableBindings: [],
      },
      pair: ratioPair,
      sources: { orders: { id: 'orders', complete: true, rows: [
        { status: 'PAID', net: 73852000, gross: 78053000, refund: 2945000 },
        { status: 'REFUNDED', net: 0, gross: 5787000, refund: 5702000 },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.scalars.find((scalar) => scalar.id === 'refund-rate')?.expression).toMatchObject({
      left: { kind: 'sum', where: eligible },
      right: { kind: 'sum', where: eligible },
    });
  });

  it('tries having subsets when a displayed table contains only one evidenced threshold', () => {
    const riskPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'risk-group', columnCount: 3, rowCount: 3,
        rows: [
          ['A', '50.00%', '1.00%'],
          ['B', '40.00%', '4.00%'],
          ['C', '30.00%', '0.00%'],
        ].map(([name, attainment, rate], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `risk-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: name, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `risk-attainment-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: attainment, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `risk-rate-${index}`, pageIndex: 0, rect: { x: 43, y: 20 + index * 10, width: 20, height: 8 }, exampleText: rate, fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const sum = (path: string) => ({ kind: 'sum' as const, value: field(path) });
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'ledger',
      joins: [],
      scalars: [],
      tables: [{
        kind: 'aggregate' as const,
        id: 'risk',
        groupBy: [{ id: 'name', value: field('ledger.name') }],
        columns: [
          { id: 'name', value: { kind: 'group_key' as const, keyId: 'name' } },
          { id: 'attainment', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const,
            operation: 'divide' as const, left: sum('ledger.sales'), right: sum('ledger.target') } }, format: { style: 'percent' as const, decimals: 2 } },
          { id: 'rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const,
            operation: 'divide' as const, left: sum('ledger.refund'), right: sum('ledger.gross') } }, format: { style: 'percent' as const, decimals: 2 } },
        ],
        having: { kind: 'and' as const, items: [
          { kind: 'compare' as const, operation: 'lt' as const, left: { kind: 'column' as const, columnId: 'attainment' }, right: { kind: 'literal' as const, value: 0.6 } },
          { kind: 'compare' as const, operation: 'gt' as const, left: { kind: 'column' as const, columnId: 'rate' }, right: { kind: 'literal' as const, value: 0.03 } },
        ] },
        sort: [{ columnId: 'attainment', direction: 'asc' as const }],
        limit: 3,
      }],
      texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan,
      layout: {
        schemaVersion: 1,
        outputFileName: 'report.pdf',
        scalarBindings: [],
        tableBindings: [{ groupId: 'risk-group', tableId: 'risk', columns: [
          { columnIndex: 0, columnId: 'name' }, { columnIndex: 1, columnId: 'attainment' }, { columnIndex: 2, columnId: 'rate' },
        ] }],
      },
      pair: riskPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'A', sales: 50, target: 100, refund: 1, gross: 100 },
        { name: 'B', sales: 40, target: 100, refund: 4, gross: 100 },
        { name: 'C', sales: 30, target: 100, refund: 0, gross: 100 },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables[0]).toMatchObject({
      having: { kind: 'compare', operation: 'lt', left: { kind: 'column', columnId: 'attainment' } },
      sort: [{ columnId: 'attainment', direction: 'desc' }],
    });
  });

  it('copies an evidenced sibling row filter to an unfiltered aggregate table', () => {
    const filteredTablePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'target-group', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'target-name', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'A', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'target-amount', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: 'KRW 2', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const eligible = {
      kind: 'in' as const,
      value: field('ledger.status'),
      values: [{ kind: 'literal' as const, value: 'PAID' }],
    };
    const table = (id: string, filter?: typeof eligible) => ({
      kind: 'aggregate' as const, id,
      groupBy: [{ id: 'name', value: field('ledger.name') }],
      columns: [
        { id: 'name', value: { kind: 'group_key' as const, keyId: 'name' } },
        { id: 'amount', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.amount') } }, format: { style: 'currency' as const, currency: 'KRW', decimals: 0 } },
      ],
      ...(filter ? { filter } : {}),
      limit: 1,
    });
    const repaired = repairExampleReplayInference({
      plan: { schemaVersion: 1, baseSource: 'ledger', joins: [], scalars: [],
        tables: [table('source', eligible), table('target')], texts: [] },
      layout: {
        schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [],
        tableBindings: [{ groupId: 'target-group', tableId: 'target', columns: [
          { columnIndex: 0, columnId: 'name' }, { columnIndex: 1, columnId: 'amount' },
        ] }],
      },
      pair: filteredTablePair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'A', status: 'PAID', amount: 1 }, { name: 'A', status: 'PAID', amount: 1 }, { name: 'A', status: 'REFUNDED', amount: 100 },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    const target = repaired.plan.tables.find((candidate) => candidate.id === 'target');
    expect(target?.kind === 'aggregate' ? target.filter : undefined).toEqual(eligible);
  });

  it('propagates a dataset filter across tables with different groupings', () => {
    const datasetFilterPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'target-group', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'target-region', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'A', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'target-amount', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: 'KRW 2', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const eligible = {
      kind: 'in' as const,
      value: field('ledger.status'),
      values: [{ kind: 'literal' as const, value: 'PAID' }],
    };
    const table = (id: string, dataset: string, groupId: string) => ({
      kind: 'aggregate' as const, id, dataset,
      groupBy: [{ id: groupId, value: field(`ledger.${groupId}`) }],
      columns: [
        { id: groupId, value: { kind: 'group_key' as const, keyId: groupId } },
        { id: 'amount', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.amount') } }, format: { style: 'currency' as const, currency: 'KRW', decimals: 0 } },
      ],
      limit: 1,
    });
    const repaired = repairExampleReplayInference({
      plan: {
        schemaVersion: 1,
        baseSource: 'ledger',
        joins: [],
        datasets: [
          { id: 'filtered', baseSource: 'ledger', joins: [], filter: eligible },
          { id: 'unfiltered', baseSource: 'ledger', joins: [] },
        ],
        scalars: [],
        tables: [table('source', 'filtered', 'name'), table('target', 'unfiltered', 'region')],
        texts: [],
      },
      layout: {
        schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [],
        tableBindings: [{ groupId: 'target-group', tableId: 'target', columns: [
          { columnIndex: 0, columnId: 'region' }, { columnIndex: 1, columnId: 'amount' },
        ] }],
      },
      pair: datasetFilterPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'A', region: 'A', status: 'PAID', amount: 1 },
        { name: 'A', region: 'A', status: 'PAID', amount: 1 },
        { name: 'A', region: 'A', status: 'REFUNDED', amount: 100 },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    const target = repaired.plan.tables.find((candidate) => candidate.id === 'target');
    expect(target?.kind === 'aggregate' ? target.dataset : undefined).toBe('unfiltered');
    expect(target?.kind === 'aggregate' ? target.filter : undefined).toEqual(eligible);
  });

  it('propagates an evidenced row filter to hidden aggregates used by a table ratio', () => {
    const ratioTablePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'ratio-group', columnCount: 2, rowCount: 2,
        rows: [
          ['A', '1.00%'],
          ['B', '0.00%'],
        ].map(([name, rate], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `ratio-name-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: name, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `ratio-rate-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: rate, fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const eligible = {
      kind: 'in' as const,
      value: field('ledger.status'),
      values: [{ kind: 'literal' as const, value: 'PAID' }],
    };
    const sum = (path: string) => ({ kind: 'sum' as const, value: field(path) });
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'ledger',
      joins: [],
      scalars: [{ id: 'recognized', expression: { kind: 'sum' as const, value: field('ledger.net'), where: eligible } }],
      tables: [{
        kind: 'aggregate' as const,
        id: 'ratio',
        groupBy: [{ id: 'name', value: field('ledger.name') }],
        columns: [
          { id: 'name', value: { kind: 'group_key' as const, keyId: 'name' } },
          { id: 'refund', value: { kind: 'aggregate' as const, expression: sum('ledger.refund') } },
          { id: 'gross', value: { kind: 'aggregate' as const, expression: sum('ledger.gross') } },
          { id: 'rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const,
            operation: 'divide' as const, left: { kind: 'column' as const, columnId: 'refund' }, right: { kind: 'column' as const, columnId: 'gross' } } }, format: { style: 'percent' as const, decimals: 2 } },
        ],
      }],
      texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan,
      layout: {
        schemaVersion: 1,
        outputFileName: 'report.pdf',
        scalarBindings: [],
        tableBindings: [{ groupId: 'ratio-group', tableId: 'ratio', columns: [
          { columnIndex: 0, columnId: 'name' }, { columnIndex: 1, columnId: 'rate' },
        ] }],
      },
      pair: ratioTablePair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'A', status: 'PAID', net: 100, refund: 1, gross: 100 },
        { name: 'A', status: 'REFUNDED', net: 0, refund: 9, gross: 100 },
        { name: 'B', status: 'PAID', net: 100, refund: 0, gross: 100 },
        { name: 'B', status: 'REFUNDED', net: 0, refund: 4, gross: 100 },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    for (const id of ['refund', 'gross']) {
      const column = repaired.plan.tables[0]?.kind === 'aggregate'
        ? repaired.plan.tables[0].columns.find((candidate) => candidate.id === id)
        : undefined;
      expect(column?.value).toMatchObject({ kind: 'aggregate' });
      expect(column?.value.kind === 'aggregate' ? column.value.expression.where : undefined).toEqual(eligible);
    }
  });

  it('repairs a table ratio denominator from a sibling net-plus-refund rule', () => {
    const denominatorPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'denominator-group', columnCount: 2, rowCount: 2,
        rows: [
          ['A', '0.99%'],
          ['B', '0.00%'],
        ].map(([name, rate], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `denominator-name-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: name, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `denominator-rate-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: rate, fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const eligible = {
      kind: 'in' as const,
      value: field('ledger.status'),
      values: [{ kind: 'literal' as const, value: 'PAID' }],
    };
    const sum = (path: string) => ({ kind: 'sum' as const, value: field(path) });
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'ledger',
      joins: [],
      scalars: [{ id: 'recognized', expression: { kind: 'sum' as const, value: field('ledger.net'), where: eligible } }],
      tables: [{
        kind: 'aggregate' as const,
        id: 'ratio',
        groupBy: [{ id: 'name', value: field('ledger.name') }],
        columns: [
          { id: 'name', value: { kind: 'group_key' as const, keyId: 'name' } },
          { id: 'refund', value: { kind: 'aggregate' as const, expression: sum('ledger.refund') } },
          { id: 'gross', value: { kind: 'aggregate' as const, expression: sum('ledger.gross') } },
          { id: 'rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const,
            operation: 'divide' as const, left: { kind: 'column' as const, columnId: 'refund' }, right: { kind: 'column' as const, columnId: 'gross' } } }, format: { style: 'percent' as const, decimals: 2 } },
        ],
      }],
      texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan,
      layout: {
        schemaVersion: 1,
        outputFileName: 'report.pdf',
        scalarBindings: [],
        tableBindings: [{ groupId: 'denominator-group', tableId: 'ratio', columns: [
          { columnIndex: 0, columnId: 'name' }, { columnIndex: 1, columnId: 'rate' },
        ] }],
      },
      pair: denominatorPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'A', status: 'PAID', net: 100, refund: 1, gross: 100 },
        { name: 'A', status: 'REFUNDED', net: 0, refund: 9, gross: 100 },
        { name: 'B', status: 'PAID', net: 100, refund: 0, gross: 100 },
        { name: 'B', status: 'REFUNDED', net: 0, refund: 4, gross: 100 },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    const table = repaired.plan.tables[0]?.kind === 'aggregate' ? repaired.plan.tables[0] : undefined;
    const rate = table?.columns.find((column) => column.id === 'rate');
    const denominator = table?.columns.find((column) => column.id === 'gross');
    expect(rate).toMatchObject({ id: 'rate', value: { kind: 'derived', expression: {
      left: { kind: 'column', columnId: 'refund' }, right: { kind: 'column', columnId: 'gross' },
    } } });
    expect(denominator).toMatchObject({ id: 'gross', value: { kind: 'aggregate', expression: {
      kind: 'sum', value: { kind: 'arithmetic', operation: 'add' }, where: eligible,
    } } });
  });

  it('repairs structural suffixes in reusable concatenated group keys', () => {
    const suffixPair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'accounts-group', columnCount: 2, rowCount: 2,
        rows: [
          ['North', 'N-17', 40],
          ['South', 'S-29', 35],
        ].map(([name, code, amount], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `account-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: `${name} [${code}]`, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `amount-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: String(amount), fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'accounts', groupBy: [{ id: 'account', value: {
        kind: 'concat' as const, values: [field('ledger.name'), field('ledger.code')], separator: ' ['
      } }], columns: [
        { id: 'account', value: { kind: 'group_key' as const, keyId: 'account' } },
        { id: 'amount', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.amount') } } },
      ] }], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [{ groupId: 'accounts-group', tableId: 'accounts', columns: [
        { columnIndex: 0, columnId: 'account' }, { columnIndex: 1, columnId: 'amount' },
      ] }],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: suffixPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'North', code: 'N-17', amount: 40 },
        { name: 'South', code: 'S-29', amount: 35 },
      ] } },
      metadata: { periodLabel: '2026년 8월' },
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables[0]).toMatchObject({
      groupBy: [{ value: { kind: 'concat', values: [
        { kind: 'concat', values: [
          { kind: 'field', path: 'ledger.name' }, { kind: 'field', path: 'ledger.code' },
        ], separator: ' [' },
        { kind: 'literal', value: ']' },
      ], separator: '' } }],
    });
  });

  it('removes a structural concat literal when its separator creates an extra prefix', () => {
    const malformedPair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'accounts-group', columnCount: 2, rowCount: 2,
        rows: [
          ['North', 'N-17', 40],
          ['South', 'S-29', 35],
        ].map(([name, code, amount], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `account-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: `${name} [${code}`, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `amount-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: String(amount), fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'accounts', groupBy: [{ id: 'account', value: {
        kind: 'concat' as const,
        values: [field('ledger.name'), field('ledger.code'), { kind: 'literal' as const, value: ']' }],
        separator: ' [',
      } }], columns: [
        { id: 'account', value: { kind: 'group_key' as const, keyId: 'account' } },
        { id: 'amount', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.amount') } } },
      ] }], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [{ groupId: 'accounts-group', tableId: 'accounts', columns: [
        { columnIndex: 0, columnId: 'account' }, { columnIndex: 1, columnId: 'amount' },
      ] }],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: malformedPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'North', code: 'N-17', amount: 40 },
        { name: 'South', code: 'S-29', amount: 35 },
      ] } },
      metadata: { periodLabel: '2026년 8월' },
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables[0]).toMatchObject({
      groupBy: [{ value: {
        kind: 'concat', values: [
          { kind: 'field', path: 'ledger.name' }, { kind: 'field', path: 'ledger.code' },
        ], separator: ' [',
      } }],
    });
  });

  it('restores a missing structural separator without duplicating the closing literal', () => {
    const gapPair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'accounts-group', columnCount: 1, rowCount: 2,
        rows: ['North', 'South'].map((name, index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [{
          id: `account-${index}`, pageIndex: 0,
          rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 },
          exampleText: `${name} (${index === 0 ? 'N-17' : 'S-29'})`, fontSize: 8, font: 'Fixture', color: 0,
        }] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'accounts', groupBy: [{ id: 'account', value: {
        kind: 'concat' as const,
        values: [field('ledger.name'), field('ledger.code'), { kind: 'literal' as const, value: ')' }],
      } }], columns: [{ id: 'account', value: { kind: 'group_key' as const, keyId: 'account' } }] }], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [{ groupId: 'accounts-group', tableId: 'accounts', columns: [{ columnIndex: 0, columnId: 'account' }] }],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: gapPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'North', code: 'N-17' }, { name: 'South', code: 'S-29' },
      ] } },
      metadata: { periodLabel: '2026년 8월' },
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables[0]).toMatchObject({
      groupBy: [{ value: {
        kind: 'concat', values: [
          { kind: 'concat', values: [field('ledger.name'), field('ledger.code')], separator: ' (' },
          { kind: 'literal', value: ')' },
        ],
      } }],
    });
  });

  it('restores a dropped dynamic identifier in a grouped label from captured fields', () => {
    const labelPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'accounts-group', columnCount: 1, rowCount: 2,
        rows: ['North', 'South'].map((name, index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [{
          id: `account-${index}`, pageIndex: 0,
          rect: { x: 1, y: 20 + index * 10, width: 80, height: 8 },
          exampleText: `${name} (${index === 0 ? 'N-17' : 'S-29'})`, fontSize: 8, font: 'Fixture', color: 0,
        }] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'accounts', groupBy: [{ id: 'account', value: field('ledger.name') }],
        columns: [{ id: 'account', value: { kind: 'group_key' as const, keyId: 'account' } }] }], texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan,
      layout: {
        schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [],
        tableBindings: [{ groupId: 'accounts-group', tableId: 'accounts', columns: [{ columnIndex: 0, columnId: 'account' }] }],
      },
      pair: labelPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { name: 'North', code: 'N-17' }, { name: 'South', code: 'S-29' },
      ] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables[0]).toMatchObject({
      groupBy: [{ value: { kind: 'concat', values: [
        { kind: 'concat', values: [
          { kind: 'field', path: 'ledger.name' }, { kind: 'field', path: 'ledger.code' },
        ], separator: ' (' },
        { kind: 'literal', value: ')' },
      ], separator: '' } }],
    });
  });

  it('derives a missing duplicated KPI from grouped aggregate evidence', () => {
    const kpiPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'rate-current', exampleText: '3.00%' },
        { ...pair.scalarSlots[0]!, id: 'rate-target', exampleText: '62.50%' },
      ],
      tableGroups: [{
        id: 'accounts-group', columnCount: 3, rowCount: 2,
        rows: [
          ['North', '50', '80'],
          ['South', '25', '40'],
        ].map(([account, sales, target], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `account-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: account, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `sales-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: sales, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `target-${index}`, pageIndex: 0, rect: { x: 43, y: 20 + index * 10, width: 20, height: 8 }, exampleText: target, fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [],
      scalars: [{ id: 'rate', expression: { kind: 'arithmetic' as const, operation: 'divide' as const,
        left: { kind: 'sum' as const, value: field('ledger.refund') }, right: { kind: 'sum' as const, value: field('ledger.gross') } },
        format: { style: 'percent' as const, decimals: 2 } }],
      tables: [{ kind: 'aggregate' as const, id: 'accounts', groupBy: [{ id: 'account', value: field('ledger.account') }], columns: [
        { id: 'account', value: { kind: 'group_key' as const, keyId: 'account' } },
        { id: 'sales', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.net') } } },
        { id: 'target', value: { kind: 'aggregate' as const, expression: { kind: 'first' as const, value: field('ledger.target') } } },
      ] }], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'rate-current', value: { kind: 'scalar' as const, id: 'rate' } },
        { slotId: 'rate-target', value: { kind: 'scalar' as const, id: 'rate' } },
      ],
      tableBindings: [{ groupId: 'accounts-group', tableId: 'accounts', columns: [
        { columnIndex: 0, columnId: 'account' }, { columnIndex: 1, columnId: 'sales' }, { columnIndex: 2, columnId: 'target' },
      ] }],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: kpiPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [
        { account: 'North', net: 30, target: 80, gross: 100, refund: 3 },
        { account: 'North', net: 20, target: 80, gross: 100, refund: 0 },
        { account: 'South', net: 25, target: 40, gross: 100, refund: 0 },
      ] } },
      metadata: { periodLabel: '2026년 8월' },
    });

    expect(repaired.mismatches).toEqual([]);
    const targetBinding = repaired.layout.scalarBindings.find(binding => binding.slotId === 'rate-target');
    expect(targetBinding?.value).toMatchObject({ kind: 'scalar' });
    expect(targetBinding?.value).not.toEqual({ kind: 'scalar', id: 'rate' });
    expect(repaired.plan.scalars).toEqual(expect.arrayContaining([
      expect.objectContaining({ expression: expect.objectContaining({
        kind: 'arithmetic', operation: 'divide',
        right: expect.objectContaining({ kind: 'sum_distinct' }),
      }) }),
    ]));
  });

  it('repairs a grouped count metric from varied source identity evidence', () => {
    const countPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'tier-group', columnCount: 2, rowCount: 2,
        rows: [
          ['Gold', '2'],
          ['Silver', '1'],
        ].map(([tier, count], index) => ({ index, pageIndex: 0, y: 20 + index * 10, cells: [
          { id: `tier-${index}`, pageIndex: 0, rect: { x: 1, y: 20 + index * 10, width: 20, height: 8 }, exampleText: tier, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `count-${index}`, pageIndex: 0, rect: { x: 22, y: 20 + index * 10, width: 20, height: 8 }, exampleText: count, fontSize: 8, font: 'Fixture', color: 0 },
        ] })),
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'tiers', groupBy: [{ id: 'tier', value: field('orders.tier') }], columns: [
        { id: 'tier', value: { kind: 'group_key' as const, keyId: 'tier' } },
        { id: 'count', value: { kind: 'aggregate' as const, expression: { kind: 'count_distinct' as const, value: field('orders.customer_id') } }, format: { style: 'integer' as const } },
      ] }], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf', scalarBindings: [],
      tableBindings: [{ groupId: 'tier-group', tableId: 'tiers', columns: [
        { columnIndex: 0, columnId: 'tier' }, { columnIndex: 1, columnId: 'count' },
      ] }],
    };
    const repaired = repairExampleReplayInference({
      plan, layout, pair: countPair,
      sources: { orders: { id: 'orders', complete: true, rows: [
        { tier: 'Gold', customer_id: 'c1', order_id: 'o1' },
        { tier: 'Gold', customer_id: 'c1', order_id: 'o2' },
        { tier: 'Silver', customer_id: 'c2', order_id: 'o3' },
      ] } }, metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.plan.tables[0]).toMatchObject({ columns: expect.arrayContaining([
      expect.objectContaining({ id: 'count', value: { kind: 'aggregate', expression: {
        kind: 'count_distinct', value: { kind: 'field', path: 'orders.order_id' },
      } } }),
    ]) });
  });

  it('reports an unexecutable replay instead of treating it as a match', () => {
    const field = (path: string) => ({ kind: 'field' as const, path });
    const invalidPlan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'ratio',
        groupBy: [{ id: 'name', value: field('ledger.name') }], columns: [
          { id: 'rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const,
            operation: 'divide' as const,
            left: { kind: 'column' as const, columnId: 'refund' },
            right: { kind: 'column' as const, columnId: 'missing' },
          } } },
          { id: 'refund', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.refund') } } },
          { id: 'gross', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.gross') } } },
        ],
      }],
      texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan: invalidPlan,
      layout: {
        schemaVersion: 1, outputFileName: 'report.pdf',
        scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
        tableBindings: [],
      },
      pair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [{ name: 'A', refund: 1, gross: 100 }] } },
      metadata: { periodLabel: '2026년 8월' },
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.executionError).toMatch(/^report_derived_column_dependency_missing:ratio\.rate/);
  });

  it('normalizes forward derived-column references before replay', () => {
    const forwardPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [],
      tableGroups: [{
        id: 'ratio-group', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'ratio-name', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'A', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'ratio-rate', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: '1.00%', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const field = (path: string) => ({ kind: 'field' as const, path });
    const plan = {
      schemaVersion: 1 as const, baseSource: 'ledger', joins: [], scalars: [],
      tables: [{ kind: 'aggregate' as const, id: 'ratio',
        groupBy: [{ id: 'name', value: field('ledger.name') }], columns: [
          { id: 'rate', value: { kind: 'derived' as const, expression: { kind: 'arithmetic' as const,
            operation: 'divide' as const,
            left: { kind: 'column' as const, columnId: 'refund' },
            right: { kind: 'column' as const, columnId: 'gross' },
          } }, format: { style: 'percent' as const, decimals: 2 } },
          { id: 'name', value: { kind: 'group_key' as const, keyId: 'name' } },
          { id: 'refund', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.refund') } } },
          { id: 'gross', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: field('ledger.gross') } } },
        ],
      }],
      texts: [],
    };
    const repaired = repairExampleReplayInference({
      plan,
      layout: {
        schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [],
        tableBindings: [{ groupId: 'ratio-group', tableId: 'ratio', columns: [
          { columnIndex: 0, columnId: 'name' }, { columnIndex: 1, columnId: 'rate' },
        ] }],
      },
      pair: forwardPair,
      sources: { ledger: { id: 'ledger', complete: true, rows: [{ name: 'A', refund: 1, gross: 100 }] } },
      metadata: {},
    });

    expect(repaired.mismatches).toEqual([]);
    expect(repaired.executionError).toBeUndefined();
    expect(repaired.plan.tables[0]?.kind === 'aggregate'
      ? repaired.plan.tables[0].columns.map((column) => column.id)
      : []).toEqual(['name', 'refund', 'gross', 'rate']);
    expect(repaired.layout.tableBindings[0]?.columns).toEqual([
      { columnIndex: 0, columnId: 'name' }, { columnIndex: 1, columnId: 'rate' },
    ]);
  });

  it('annotates replay mismatches with their scalar or table location', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'table-risk', columnCount: 2, rowCount: 1,
        rows: [{ index: 4, pageIndex: 0, y: 20, cells: [
          { id: 'risk-name', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'Alice', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'risk-rate', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: '12%', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };

    expect(describeReportReplayMismatches(tablePair, [
      { slotId: 'period', expected: '2026-08', actual: '2026-09' },
      { slotId: 'risk-rate', expected: '12%', actual: '8%' },
    ])).toEqual([
      { slotId: 'period', expected: '2026-08', actual: '2026-09', kind: 'scalar', pageIndex: 0 },
      { slotId: 'risk-rate', expected: '12%', actual: '8%', kind: 'table', groupId: 'table-risk', rowIndex: 4, columnIndex: 1, pageIndex: 0 },
    ]);
  });

  it('rejects a calculation plan that cannot cover every discovered table group', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [4, 3, 7, 5].map((columnCount, index) => ({
        id: `table-${index}`,
        columnCount,
        rowCount: 1,
        rows: [],
      })),
    };
    const incompletePlan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [],
      scalars: [],
      tables: [4, 3].map((columnCount, index) => ({
        kind: 'aggregate' as const,
        id: `summary-${index}`,
        groupBy: [{ id: `group-${index}`, value: { kind: 'field' as const, path: 'orders.id' } }],
        columns: Array.from({ length: columnCount }, (_, column) => ({
          id: `column-${index}-${column}`,
          value: { kind: 'group_key' as const, keyId: `group-${index}` },
        })),
      })),
      texts: [],
    };

    expect(() => assertReportPlanTableCoverage(incompletePlan, tablePair))
      .toThrow('report_plan_table_coverage_incomplete:table-2');
  });

  it('matches declared result tables to groups by capacity rather than table order', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [4, 3, 7, 5].map((columnCount, index) => ({
        id: `table-${index}`,
        columnCount,
        rowCount: 1,
        rows: [],
      })),
    };
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [],
      scalars: [],
      tables: [7, 4, 5, 3].map((columnCount, index) => ({
        kind: 'aggregate' as const,
        id: `summary-${index}`,
        groupBy: [{ id: `group-${index}`, value: { kind: 'field' as const, path: 'orders.id' } }],
        columns: Array.from({ length: columnCount }, (_, column) => ({
          id: `column-${index}-${column}`,
          value: { kind: 'group_key' as const, keyId: `group-${index}` },
        })),
      })),
      texts: [],
    };

    expect(() => assertReportPlanTableCoverage(plan, tablePair)).not.toThrow();
  });

  it('infers requirements before selection without giving the model a candidate plan to rationalize', async () => {
    const seen: InvestigationRunRequest<unknown>[] = [];
    const requirements = [{ id: 'agreements', connector: 'rdb', description: 'Agreement dates', reason: 'User requested the agreement database' }];
    const runner: InvestigationRunner = { providerName: 'fixture', async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request);
      return { output: request.outputSchema.parse({ schemaVersion: 1, requirements }) };
    } };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    await expect(planner.inferSourceRequirements({ goal: 'Report using the agreement database', pair,
      connectedConnectors: ['http', 'rdb'] })).resolves.toEqual(requirements);
    const context = JSON.parse(seen[0]!.context.untrustedData!);
    expect(Object.keys(context)).toEqual(['reportGeometry']);
    expect(seen[0]!.logContext).toBe('report-source-requirements');
    expect(zodToCodexJsonSchema(ReportSourceRequirementsSchema)).toMatchObject({ type: 'object' });
    expect(ReportSourceRequirementsSchema.safeParse({ schemaVersion: 1, requirements: [...requirements, ...requirements] }).success).toBe(false);
  });
  it('serves selected evidence through the real planner and still calculates every row', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const runner = fakeRunner(seen);
    const original = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      if (request.logContext === 'report-business-plan') {
        seen.push(request);
        return { output: request.outputSchema.parse({ schemaVersion: 1,
          evidenceRequest: { kind: 'rows', source: 'orders', columns: ['id'], offset: 7, limit: 1 } }) };
      }
      if (request.logContext === 'report-business-plan-evidence-1') {
        seen.push(request);
        return { output: request.outputSchema.parse({ schemaVersion: 1,
          evidenceRequest: { kind: 'page', document: 'example', pageIndex: 0 } }) };
      }
      return original(request);
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([9]) });
    const capture = await planner.inferCapturePlan({ goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'] });
    await planner.inferReportPlan({ goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true,
        rows: Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}`, privateField: 'not-requested' })) } },
      connectedConnectors: ['http'] });
    const selected = seen.find((request) => request.logContext === 'report-business-plan-evidence-1');
    expect(selected?.context.untrustedData).toContain('row-7');
    expect(selected?.context.untrustedData).not.toContain('row-8');
    expect(selected?.context.untrustedData).not.toContain('not-requested');
    const withImage = seen.find((request) => request.logContext === 'report-business-plan-evidence-2');
    expect(withImage?.images?.map((image) => image.filename)).toEqual(['example-page-1.png']);
    const layout = seen.find((request) => request.logContext === 'report-layout-plan');
    const data = JSON.parse(layout!.context.untrustedData!);
    expect(data.calculated.scalars.orderCount.raw).toBe(1000);
  });

  it('rejects an executable type error before layout and gives the model one correction turn', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const baseRunner = fakeRunner(seen);
    let calculationCalls = 0;
    const validPlan = {
      schemaVersion: 1 as const,
      baseSource: 'orders', joins: [],
      scalars: [{ id: 'orderCount', expression: { kind: 'count' as const } }],
      tables: [], texts: [],
    };
    const invalidPlan = {
      ...validPlan,
      scalars: [{ id: 'periodMinusOne', expression: {
        kind: 'arithmetic' as const, operation: 'subtract' as const,
        left: { kind: 'field' as const, path: 'meta.periodEndExclusive' },
        right: { kind: 'literal' as const, value: 1 },
      } }],
    };
    const runner: InvestigationRunner = {
      providerName: 'fixture',
      async run<T>(request: InvestigationRunRequest<T>) {
        if (request.logContext?.startsWith('report-business-plan')) {
          seen.push(request as InvestigationRunRequest<unknown>);
          calculationCalls += 1;
          const reportPlan = calculationCalls === 1 ? invalidPlan : validPlan;
          return { output: request.outputSchema.parse({ schemaVersion: 1, reportPlan }) };
        }
        return baseRunner.run(request);
      },
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({ goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'] });
    const result = await planner.inferReportPlan({ goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'row' }] } },
      connectedConnectors: ['http'] });

    expect(result.reportPlan.scalars.map((scalar) => scalar.id)).toEqual(['orderCount']);
    expect(calculationCalls).toBe(2);
    const correction = JSON.parse(seen.find((request) => request.logContext === 'report-business-plan-evidence-1')!.context.untrustedData!);
    expect(correction.validationIssues).toEqual([{ code: 'report_plan_execution_invalid', path: ['report_number_required'] }]);
  });

  it('does not disclose source rows or PDF images in the first calculation call', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const planner = new ReportPlanner(fakeRunner(seen), { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({ goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'] });
    await planner.inferReportPlan({ goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true,
        rows: Array.from({ length: 1000 }, (_, i) => ({ id: `private-row-${i}` })) } },
      connectedConnectors: ['http'] });
    const calculation = seen.find((request) => request.logContext === 'report-business-plan');
    expect(calculation?.context.untrustedData).not.toContain('private-row-');
    expect(calculation?.images ?? []).toHaveLength(0);
    expect(calculation?.context.untrustedData).toContain('rowCount');
    const layout = seen.find((request) => request.logContext === 'report-layout-plan');
    expect(layout?.context.untrustedData).toContain('1000');
    expect(layout?.context.untrustedData).not.toContain('private-row-');
  });

  it('provides aggregate date coverage hints so period fields are evidence based', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const planner = new ReportPlanner(fakeRunner(seen), { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({ goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'] });
    await planner.inferReportPlan({ goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [
        { ordered_at: '2026-07-31T23:00:00+09:00', paid_at: '2026-08-01T01:00:00+09:00' },
        { ordered_at: '2026-08-02T01:00:00+09:00', paid_at: '2026-08-02T02:00:00+09:00' },
      ] } },
      connectedConnectors: ['http'] });
    const context = JSON.parse(seen.find((request) => request.logContext === 'report-business-plan')!.context.untrustedData!);
    expect(context.task.sourceDateCoverage.orders).toEqual(expect.objectContaining({
      ordered_at: expect.objectContaining({ inPeriod: 1, totalDates: 2 }),
      paid_at: expect.objectContaining({ inPeriod: 2, totalDates: 2 }),
    }));
  });

  it('compacts repeated calculation geometry while preserving table samples and counts', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const table = {
      id: 'customers', columnCount: 2, rowCount: 10,
      rows: Array.from({ length: 10 }, (_, index) => ({ index, pageIndex: 0, y: index * 18,
        cells: [
          { id: `name-${index}`, pageIndex: 0, rect: { x: 1, y: index, width: 20, height: 8 },
            exampleText: `Customer ${index}`, fontSize: 8, font: 'Fixture', color: 0 },
          { id: `amount-${index}`, pageIndex: 0, rect: { x: 22, y: index, width: 20, height: 8 },
            exampleText: String(index * 10), fontSize: 8, font: 'Fixture', color: 0 },
        ],
      })),
      pageBounds: [{ pageIndex: 0, x: 1, width: 42 }],
    };
    const largePair = { ...pair, tableGroups: [table] };
    const runner = fakeRunner(seen);
    const baseRun = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      const response = await baseRun(request);
      if (request.logContext === 'report-business-plan') {
        return { output: request.outputSchema.parse({
          schemaVersion: 1,
          reportPlan: {
            schemaVersion: 1,
            baseSource: 'orders',
            joins: [],
            scalars: [{ id: 'orderCount', expression: { kind: 'count' } }],
            tables: [{
              kind: 'aggregate', id: 'customers',
              groupBy: [{ id: 'customer', value: { kind: 'field', path: 'orders.id' } }],
              columns: [
                { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
                { id: 'amount', value: { kind: 'aggregate', expression: { kind: 'sum', value: { kind: 'field', path: 'orders.amount' } } } },
              ],
            }],
            texts: [],
          },
        }) as T };
      }
      if (request.logContext === 'report-layout-plan') {
        return { output: request.outputSchema.parse({
          schemaVersion: 1,
          layout: {
            schemaVersion: 1,
            outputFileName: 'report-{{meta.periodYear}}.pdf',
            scalarBindings: [{ slotId: 'period', value: { kind: 'metadata', key: 'periodLabel' } }],
            tableBindings: [{ groupId: 'customers', tableId: 'customers', columns: [
              { columnIndex: 0, columnId: 'customer' }, { columnIndex: 1, columnId: 'amount' },
            ] }],
          },
        }) as T };
      }
      return response;
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({ goal: 'report', pair: largePair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'] });
    await planner.inferReportPlan({ goal: 'report', pair: largePair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: Array.from({ length: 10 }, (_, index) => ({
        id: `Customer ${index}`, amount: index * 10,
      })) } },
      connectedConnectors: ['http'] });
    const calculation = seen.find((request) => request.logContext === 'report-business-plan');
    const geometry = JSON.parse(calculation!.context.untrustedData!).task.reportGeometry;
    expect(geometry.tableGroups[0].rowCount).toBe(10);
    expect(geometry.tableGroups[0].rows.map((row: { index: number }) => row.index)).toEqual([0, 1, 2, 7, 8, 9]);
    expect(geometry.tableGroups[0].rows[0].cells[0]).toMatchObject({ id: 'name-0', exampleText: 'Customer 0' });
    expect(JSON.stringify(geometry)).not.toContain('font');
    expect(seen.find((request) => request.logContext === 'report-layout-plan')?.context.skillGoal)
      .toContain('customers=2 columns');
  });

  it('reuses calculation after a layout failure through the execution checkpoint seam', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const runner = fakeRunner(seen);
    const original = runner.run.bind(runner);
    let failLayout = true;
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      if (request.logContext === 'report-layout-plan' && failLayout) {
        failLayout = false;
        throw Object.assign(new Error('timeout'), { code: 'agent_timeout' });
      }
      return original(request);
    };
    const saved = new Map<string, unknown>();
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) }).forExecution(
      async <T>(name: string, input: unknown, run: () => Promise<T>) => {
        const key = JSON.stringify([name, input]);
        if (saved.has(key)) return saved.get(key) as T;
        const value = await run();
        saved.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    );
    const capture = await planner.inferCapturePlan({ goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'] });
    const input = { goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'row' }] } },
      connectedConnectors: ['http'] };
    await expect(planner.inferReportPlan(input)).rejects.toThrow('timeout');
    await expect(planner.inferReportPlan(input)).resolves.toMatchObject({ reportPlan: { baseSource: 'orders' } });
    expect(seen.filter((request) => request.logContext === 'report-business-plan')).toHaveLength(1);
  });

  it('repairs an omitted static text binding from an exact example slot', async () => {
    const reportPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        ...pair.scalarSlots,
        {
          id: 'note', pageIndex: 0, rect: { x: 30, y: 1, width: 120, height: 10 },
          exampleText: 'Reviewed source data only.', fontSize: 10, font: 'Fixture', color: 0,
        },
      ],
    };
    const capture = {
      schemaVersion: 1 as const,
      examplePeriod: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' },
      targetPeriod: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' },
      capturePlan: {
        schemaVersion: 1 as const,
        http: [{ alias: 'orders', connectionId: 'orders-api', path: '/orders', rowsPath: '$' }],
        rdb: [],
      },
    };
    const runner: InvestigationRunner = {
      providerName: 'fixture',
      async run<T>(request: InvestigationRunRequest<T>) {
        if (request.logContext === 'report-business-plan') {
          return { output: request.outputSchema.parse({
            schemaVersion: 1,
            reportPlan: {
              schemaVersion: 1,
              baseSource: 'orders',
              joins: [],
              scalars: [{ id: 'orderCount', expression: { kind: 'count' }, format: { style: 'integer' } }],
              tables: [],
              texts: [{ id: 'note', kind: 'invariant', value: 'Reviewed source data only.' }],
            },
          }) as T };
        }
        return { output: request.outputSchema.parse({
          schemaVersion: 1,
          layout: {
            schemaVersion: 1,
            outputFileName: 'report-{{meta.periodYear}}.pdf',
            scalarBindings: [{ slotId: 'period', value: { kind: 'metadata', key: 'periodLabel' } }],
            tableBindings: [],
          },
        }) as T };
      },
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });

    const result = await planner.inferReportPlan({
      goal: 'report', pair: reportPair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'o1' }] } },
      connectedConnectors: ['http'],
    });

    expect(result.layout.scalarBindings).toContainEqual({
      slotId: 'note', value: { kind: 'text', id: 'note' },
    });
  });

  it('repairs a layout text id that is missing from the calculation plan', () => {
    const notePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, id: 'note', exampleText: 'Reviewed source data only.' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'note', value: { kind: 'text' as const, id: 'missing-note' } }],
      tableBindings: [],
    };

    const repaired = repairStaticTextBindingConflicts(plan, layout, notePair);
    expect(repaired.plan.texts).toEqual([{
      id: 'missing-note-example-note', kind: 'invariant', value: 'Reviewed source data only.',
    }]);
    expect(repaired.layout.scalarBindings[0]?.value).toEqual({
      kind: 'text', id: 'missing-note-example-note',
    });
  });

  it('restores paraphrased static text from its bound example slot', async () => {
    const reportPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        ...pair.scalarSlots,
        {
          id: 'note', pageIndex: 0, rect: { x: 30, y: 1, width: 120, height: 10 },
          exampleText: 'Reviewed source data only.', fontSize: 10, font: 'Fixture', color: 0,
        },
      ],
    };
    const capture = {
      schemaVersion: 1 as const,
      examplePeriod: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' },
      targetPeriod: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' },
      capturePlan: {
        schemaVersion: 1 as const,
        http: [{ alias: 'orders', connectionId: 'orders-api', path: '/orders', rowsPath: '$' }],
        rdb: [],
      },
    };
    const runner: InvestigationRunner = {
      providerName: 'fixture',
      async run<T>(request: InvestigationRunRequest<T>) {
        if (request.logContext === 'report-business-plan') {
          return { output: request.outputSchema.parse({
            schemaVersion: 1,
            reportPlan: {
              schemaVersion: 1,
              baseSource: 'orders',
              joins: [],
              scalars: [{ id: 'orderCount', expression: { kind: 'count' }, format: { style: 'integer' } }],
              tables: [],
              texts: [{ id: 'note', kind: 'invariant', value: 'Reviewed source data only for this report.' }],
            },
          }) as T };
        }
        return { output: request.outputSchema.parse({
          schemaVersion: 1,
          layout: {
            schemaVersion: 1,
            outputFileName: 'report-{{meta.periodYear}}.pdf',
            scalarBindings: [
              { slotId: 'period', value: { kind: 'metadata', key: 'periodLabel' } },
              { slotId: 'note', value: { kind: 'text', id: 'note' } },
            ],
            tableBindings: [],
          },
        }) as T };
      },
    };

    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const result = await planner.inferReportPlan({
      goal: 'report', pair: reportPair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'o1' }] } },
      connectedConnectors: ['http'],
    });

    expect(result.reportPlan.texts).toContainEqual({ id: 'note', kind: 'invariant', value: 'Reviewed source data only.' });
  });

  it('exposes a Codex-compatible structured output contract', () => {
    expect(zodToCodexJsonSchema(ReportBusinessInferenceSchema)).toMatchObject({ type: 'object' });
  });

  it('uses image bytes and structured contracts without leaking host paths into prompts', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const planner = new ReportPlanner(fakeRunner(seen), {
      readImage: () => Uint8Array.from([1, 2, 3]),
    });
    const capture = await planner.inferCapturePlan({
      goal: '지난 보고서와 같은 기준으로 다음 달 보고서를 만들어줘',
      pair,
      httpConnections: [{ id: 'orders-api', label: '주문 API', basePath: '/' }],
      rdbTables: ['public.customers'],
      connectedConnectors: ['http', 'rdb', 'document'],
    });
    const sources: Record<string, ReportSourceSnapshot> = {
      orders: { id: 'orders', complete: true, rows: [{ order_id: 'o1' }] },
    };
    const planned = await planner.inferReportPlan({
      goal: '지난 보고서와 같은 기준으로 다음 달 보고서를 만들어줘',
      pair,
      capture,
      exampleSources: sources,
      connectedConnectors: ['http', 'rdb', 'document'],
    });

    expect(capture.targetPeriod.label).toBe('2026년 9월');
    expect(planned.reportPlan.baseSource).toBe('orders');
    expect(seen).toHaveLength(3);
    expect(seen.map((request) => request.images?.length ?? 0)).toEqual([2, 0, 2]);
    expect(seen.flatMap((request) => request.images ?? []).map((image) => image.filename)).toEqual([
      'template-page-1.png', 'example-page-1.png',
      'template-page-1.png', 'example-page-1.png',
    ]);
    expect(seen.map((request) => request.context.untrustedData).join('\n')).not.toContain('host-only');
  });

  it('rejects a report plan that references a source outside the capture contract', async () => {
    const runner = fakeRunner([]);
    const original = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      const response = await original(request);
      if (request.logContext?.startsWith('report-business-plan')) {
        const output = response.output as Record<string, unknown>;
        (output.reportPlan as Record<string, unknown>).baseSource = 'invented';
      }
      return response;
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({
      goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });
    await expect(planner.inferReportPlan({
      goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [] } },
      connectedConnectors: ['http'],
    })).rejects.toThrow('report_plan_source_not_captured:invented');
  });

  it('refines pagination and date parameters from a value-free endpoint probe', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const planner = new ReportPlanner(fakeRunner(seen), { readImage: () => new Uint8Array([1]) });
    const input = {
      goal: '다음 달 보고서를 만들어줘', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [] as string[], connectedConnectors: ['http'],
    };
    const provisional = await planner.inferCapturePlan(input);
    const refined = await planner.refineCapturePlan({
      ...input,
      provisional,
      httpProbes: [{
        alias: 'orders', path: '/api/v1/orders', status: 200,
        shape: {
          type: 'object',
          fields: {
            data: { type: 'array', length: 50, item: { type: 'object', fields: { id: { type: 'string' } } } },
            meta: { type: 'object', fields: { page: { type: 'number' }, total_pages: { type: 'number' } } },
          },
        },
      }],
    });

    expect(refined.capturePlan.http[0]).toMatchObject({
      rowsPath: 'data',
      dateQuery: { fromParam: 'from', toParam: 'to' },
      pagination: { pageParam: 'page', sizeParam: 'size', totalPagesPath: 'meta.total_pages' },
    });
    expect(seen.at(-1)?.logContext).toBe('report-source-refinement');
  });

  it('revises a business plan from bounded example replay evidence without target data', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const planner = new ReportPlanner(fakeRunner(seen), { readImage: () => new Uint8Array([1]) });
    const revisionPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, exampleText: 'historical display' }],
    };
    const capture = await planner.inferCapturePlan({
      goal: 'next report', pair: revisionPair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });
    const exampleSources = { orders: { id: 'orders', complete: true, rows: [{ id: 'row-a' }] } };
    const previous = await planner.inferReportPlan({
      goal: 'next report', pair: revisionPair, capture, exampleSources, connectedConnectors: ['http'],
    });

    const revised = await planner.reviseReportPlan({
      goal: 'next report', pair: revisionPair, capture, exampleSources, previous,
      replayFailure: {
        mismatches: [{ slotId: 'period', expected: 'historical display', actual: 'wrong display' }],
      },
      connectedConnectors: ['http'],
    });

    expect(revised.reportPlan.baseSource).toBe('orders');
    expect(seen.at(-1)?.logContext).toBe('report-layout-plan-revision');
    expect(seen.find((request) => request.logContext === 'report-business-plan-revision')?.context.untrustedData).toContain('historical display');
    expect(seen.at(-1)?.context.untrustedData).not.toContain('exampleSources');
    expect(seen.at(-1)?.context.untrustedData).not.toContain('targetSources');
    const revision = seen.find((request) => request.logContext === 'report-business-plan-revision');
    expect(revision?.context.untrustedData).not.toContain('row-a');
    expect(revision?.images ?? []).toHaveLength(0);
  });

  it('finishes a replayable revision without another model turn', async () => {
    let modelCalls = 0;
    const runner: InvestigationRunner = {
      providerName: 'fixture',
      async run<T>() {
        modelCalls += 1;
        throw new Error('model_should_not_run');
      },
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = {
      schemaVersion: 1 as const,
      examplePeriod: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' },
      targetPeriod: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' },
      capturePlan: {
        schemaVersion: 1 as const,
        http: [{ alias: 'orders', connectionId: 'orders-api', path: '/orders', rowsPath: '$' }],
        rdb: [],
      },
    };
    const previous = {
      schemaVersion: 1 as const,
      reportPlan: {
        schemaVersion: 1 as const, baseSource: 'orders', joins: [],
        scalars: [{ id: 'orderCount', expression: { kind: 'count' as const }, format: { style: 'integer' as const } }],
        tables: [], texts: [],
      },
      layout: {
        schemaVersion: 1 as const, outputFileName: 'report-{{meta.periodYear}}.pdf',
        scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
        tableBindings: [],
      },
    };

    const revised = await planner.reviseReportPlan({
      goal: 'next report', pair, capture, exampleSources: {
        orders: { id: 'orders', complete: true, rows: [{ id: 'row-a' }] },
      }, previous,
      replayFailure: { mismatches: [{ slotId: 'period', expected: 'old', actual: 'new' }] },
      connectedConnectors: ['http'],
    });

    expect(modelCalls).toBe(0);
    expect(revised.reportPlan.scalars[0]?.id).toBe('orderCount');
  });

  it('preserves scalar and table formats when a revision omits them', async () => {
    const seen: Array<InvestigationRunRequest<unknown>> = [];
    const baseRunner = fakeRunner(seen);
    const original = baseRunner.run.bind(baseRunner);
    baseRunner.run = async <T>(request: InvestigationRunRequest<T>) => {
      if (request.logContext === 'report-business-plan-revision') {
        return { output: request.outputSchema.parse({
          schemaVersion: 1,
          reportPlan: {
            schemaVersion: 1,
            baseSource: 'orders',
            joins: [],
            scalars: [{ id: 'orderCount', expression: { kind: 'count' } }],
            tables: [{
              kind: 'aggregate', id: 'summary',
              groupBy: [{ id: 'customer', value: { kind: 'field', path: 'orders.id' } }],
              columns: [
                { id: 'customer', value: { kind: 'group_key', keyId: 'customer' } },
                { id: 'revenue', value: { kind: 'aggregate', expression: { kind: 'sum', value: { kind: 'field', path: 'orders.amount' } } } },
              ],
            }],
            texts: [],
          },
        }) as T };
      }
      return original(request);
    };
    const planner = new ReportPlanner(baseRunner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({
      goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });
    const previous = {
      schemaVersion: 1 as const,
      reportPlan: {
        schemaVersion: 1 as const,
        baseSource: 'orders',
        joins: [],
        scalars: [{ id: 'orderCount', expression: { kind: 'count' as const }, format: { style: 'integer' as const } }],
        tables: [{
          kind: 'aggregate' as const, id: 'summary',
          groupBy: [{ id: 'customer', value: { kind: 'field' as const, path: 'orders.id' } }],
          columns: [
            { id: 'customer', value: { kind: 'group_key' as const, keyId: 'customer' } },
            { id: 'revenue', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } } }, format: { style: 'currency' as const, currency: 'KRW' } },
          ],
        }],
        texts: [],
      },
      layout: {
        schemaVersion: 1 as const,
        outputFileName: 'report-{{meta.periodYear}}.pdf',
        scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
        tableBindings: [],
      },
    };
    const revised = await planner.reviseReportPlan({
      goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'o1', amount: 10 }] } },
      previous,
      replayFailure: { mismatches: [{ slotId: 'period', expected: 'old', actual: 'new' }] },
      connectedConnectors: ['http'],
    });

    expect(revised.reportPlan.scalars[0]?.format).toEqual({ style: 'integer' });
    expect(revised.reportPlan.tables[0]?.kind).toBe('aggregate');
    if (revised.reportPlan.tables[0]?.kind === 'aggregate') {
      expect(revised.reportPlan.tables[0].columns[1]?.format).toEqual({ style: 'currency', currency: 'KRW' });
    }
  });

  it('repairs table bindings that repeat template slot ids instead of result column ids', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'table-1', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'slot-a', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'North', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'slot-b', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: '10', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], texts: [],
      tables: [{
        kind: 'aggregate' as const, id: 'summary',
        groupBy: [{ id: 'region', value: { kind: 'field' as const, path: 'orders.region' } }],
        columns: [
          { id: 'region', value: { kind: 'group_key' as const, keyId: 'region' } },
          { id: 'revenue', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } } } },
        ],
      }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [{ groupId: 'table-1', tableId: 'summary', columns: [
        { columnIndex: 0, columnId: 'slot-a' }, { columnIndex: 1, columnId: 'slot-b' },
      ] }],
    };

    const repaired = repairReportLayoutBindings(plan, layout, tablePair);
    expect(repaired.tableBindings[0]?.columns).toEqual([
      { columnIndex: 0, columnId: 'region' },
      { columnIndex: 1, columnId: 'revenue' },
    ]);
  });

  it('drops an unknown group binding only when a known group has the exact same mapping', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'table-1', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'slot-a', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'North', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'slot-b', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: '10', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], texts: [],
      tables: [{
        kind: 'aggregate' as const, id: 'summary',
        groupBy: [{ id: 'region', value: { kind: 'field' as const, path: 'orders.region' } }],
        columns: [
          { id: 'region', value: { kind: 'group_key' as const, keyId: 'region' } },
          { id: 'revenue', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } } } },
        ],
      }],
    };
    const columns = [
      { columnIndex: 0, columnId: 'region' },
      { columnIndex: 1, columnId: 'revenue' },
    ];
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [
        { groupId: 'table-1', tableId: 'summary', columns },
        { groupId: 'table-1-typo', tableId: 'summary', columns },
      ],
    };

    const repaired = repairReportLayoutBindings(plan, layout, tablePair);
    expect(repaired.tableBindings).toEqual([{ groupId: 'table-1', tableId: 'summary', columns }]);
  });

  it('keeps an unknown group binding when no verified equivalent exists', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      tableGroups: [{
        id: 'table-1', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'slot-a', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'North', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'slot-b', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: '10', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], texts: [],
      tables: [{
        kind: 'aggregate' as const, id: 'summary',
        groupBy: [{ id: 'region', value: { kind: 'field' as const, path: 'orders.region' } }],
        columns: [
          { id: 'region', value: { kind: 'group_key' as const, keyId: 'region' } },
          { id: 'revenue', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } } } },
        ],
      }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [{ groupId: 'table-unknown', tableId: 'summary', columns: [
        { columnIndex: 0, columnId: 'region' }, { columnIndex: 1, columnId: 'revenue' },
      ] }],
    };

    const repaired = repairReportLayoutBindings(plan, layout, tablePair);
    expect(repaired.tableBindings).toEqual(layout.tableBindings);
  });

  it('infers omitted numeric presentation formats from the completed example cells', () => {
    const tablePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{
        id: 'revenue-slot', pageIndex: 0,
        rect: { x: 1, y: 1, width: 20, height: 10 },
        exampleText: 'KRW 10,000', fontSize: 10, font: 'Fixture', color: 0,
      }],
      tableGroups: [{
        id: 'table-1', columnCount: 2, rowCount: 1,
        rows: [{ index: 0, pageIndex: 0, y: 20, cells: [
          { id: 'slot-a', pageIndex: 0, rect: { x: 1, y: 20, width: 20, height: 8 }, exampleText: 'North', fontSize: 8, font: 'Fixture', color: 0 },
          { id: 'slot-b', pageIndex: 0, rect: { x: 22, y: 20, width: 20, height: 8 }, exampleText: '20.50%', fontSize: 8, font: 'Fixture', color: 0 },
        ] }],
      }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [],
      scalars: [{ id: 'revenue', expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } } }],
      tables: [{
        kind: 'aggregate' as const, id: 'summary',
        groupBy: [{ id: 'region', value: { kind: 'field' as const, path: 'orders.region' } }],
        columns: [
          { id: 'region', value: { kind: 'group_key' as const, keyId: 'region' } },
          { id: 'share', value: { kind: 'aggregate' as const, expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.share' } } } },
        ],
      }],
      texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'revenue-slot', value: { kind: 'scalar' as const, id: 'revenue' } }],
      tableBindings: [{ groupId: 'table-1', tableId: 'summary', columns: [
        { columnIndex: 0, columnId: 'region' }, { columnIndex: 1, columnId: 'share' },
      ] }],
    };

    const formatted = inferReportFormats(plan, layout, tablePair);
    expect(formatted.scalars[0]?.format).toEqual({ style: 'currency', currency: 'KRW', decimals: 0 });
    if (formatted.tables[0]?.kind === 'aggregate') {
      expect(formatted.tables[0].columns[1]?.format).toEqual({ style: 'percent', decimals: 2 });
    }
  });

  it('repairs an incompatible explicit format using the completed example type', () => {
    const scalarPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'manager-slot', exampleText: '김하늘' },
        { ...pair.scalarSlots[0]!, id: 'sales-slot', rect: { ...pair.scalarSlots[0]!.rect, y: 12 }, exampleText: '125,000원' },
      ],
    };
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'account_managers', joins: [],
      scalars: [
        {
          id: 'manager',
          expression: { kind: 'first' as const, value: { kind: 'field' as const, path: 'account_managers.name' } },
          format: { style: 'currency' as const, currency: 'KRW', decimals: 0 },
        },
        { id: 'sales', expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'account_managers.sales' } } },
      ],
      tables: [], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'manager-slot', value: { kind: 'scalar' as const, id: 'manager' } },
        { slotId: 'sales-slot', value: { kind: 'scalar' as const, id: 'sales' } },
      ],
      tableBindings: [],
    };

    const formatted = inferReportFormats(plan, layout, scalarPair);
    expect(formatted.scalars[0]?.format).toEqual({ style: 'text' });
    expect(formatted.scalars[1]?.format).toEqual({ style: 'currency', currency: 'KRW', decimals: 0 });
  });

  it('rebinds a scalar slot only to an exact host-calculated example value', () => {
    const scalarPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{
        ...pair.scalarSlots[0]!,
        exampleText: '2026-08-01 ~ 2026-08-31',
      }],
    };
    const result = {
      scalars: {
        range: { raw: '2026-08-01 ~ 2026-08-31', display: '2026-08-01 ~ 2026-08-31' },
      },
      tables: {},
      texts: {},
    } as ReportPlanResult;
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
      tableBindings: [],
    };

    const repaired = repairExampleScalarBindings(layout, scalarPair, result, {
      periodLabel: '2026년 8월',
    });
    expect(repaired.scalarBindings[0]?.value).toEqual({ kind: 'scalar', id: 'range' });
  });

  it('repairs a mismatched source metadata binding as exact example wording', () => {
    const sourcePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, id: 'source-slot', exampleText: 'REST 주문 + PostgreSQL CRM' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'source-slot', value: { kind: 'metadata' as const, key: 'httpSourceLabel' } }],
      tableBindings: [],
    };

    const repaired = repairExamplePresentationBindings(plan, layout, sourcePair, {
      httpSourceLabel: 'REST  GET /api/v1/orders',
    });
    expect(repaired.plan.texts).toEqual([{
      id: 'httpSourceLabel-example-source-slot', kind: 'invariant', value: 'REST 주문 + PostgreSQL CRM',
    }]);
    expect(repaired.layout.scalarBindings[0]?.value).toEqual({
      kind: 'text', id: 'httpSourceLabel-example-source-slot',
    });
  });

  it('converts a numeric invariant that matches runtime metadata into a computed token', () => {
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [{ id: 'source', kind: 'invariant' as const, value: 'REST  GET /api/v1/orders' }],
    };
    expect(repairReportMetadataTextReferences(plan, {
      httpSourceLabel: 'REST  GET /api/v1/orders',
      httpSourcePaths: '/api/v1/orders',
    }).texts).toEqual([{
      id: 'source', kind: 'computed', template: '{{meta.httpSourceLabel}}',
    }]);
  });

  it('repairs the legacy periodEnd metadata alias according to comparison semantics', () => {
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'orders',
      joins: [{
        source: 'contracts', left: 'orders.customer_id', right: 'customer_id', type: 'left' as const, cardinality: 'one' as const,
        where: { kind: 'compare' as const, operation: 'lte' as const,
          left: { kind: 'field' as const, path: 'contracts.contract_start' },
          right: { kind: 'field' as const, path: 'meta.periodEnd' } },
      }],
      filter: { kind: 'compare' as const, operation: 'lt' as const,
        left: { kind: 'field' as const, path: 'orders.paid_at' },
        right: { kind: 'field' as const, path: 'meta.periodEnd' } },
      scalars: [], tables: [], texts: [],
    };
    const repaired = repairReportMetadataReferences(plan, {
      capturePlan: { schemaVersion: 1, http: [{ alias: 'orders', path: '/orders' }], rdb: [{ alias: 'contracts', table: 'public.contracts' }] },
    });
    expect(repaired.joins[0]?.where).toMatchObject({ right: { path: 'meta.periodEndInclusive' } });
    expect(repaired.filter).toMatchObject({ right: { path: 'meta.periodEndExclusive' } });
  });

  it('maps an omitted top-level dataset reference back to the root plan', () => {
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [],
      scalars: [{ id: 'count', dataset: 'default', expression: { kind: 'count' as const } }],
      tables: [{ kind: 'aggregate' as const, id: 'summary', dataset: 'default', groupBy: [], columns: [] }],
      texts: [],
    };
    const repaired = repairReportDatasetReferences(plan);
    expect(repaired.scalars[0]).not.toHaveProperty('dataset');
    expect(repaired.tables[0]).not.toHaveProperty('dataset');
  });

  it('repairs an example phase label as a reusable phase text', () => {
    const phasePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, id: 'status-slot', exampleText: '과거 작성 예시' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'status-slot', value: { kind: 'metadata' as const, key: 'reportStatus' } }],
      tableBindings: [],
    };

    const repaired = repairExamplePresentationBindings(plan, layout, phasePair, {
      reportPhase: 'example', reportStatus: 'example',
    });
    expect(repaired.plan.texts).toEqual([{
      id: 'reportStatus-example-status-slot', kind: 'phase',
      exampleValue: '과거 작성 예시', targetMetadataKey: 'reportStatus',
    }]);
    expect(repaired.layout.scalarBindings[0]?.value).toEqual({
      kind: 'text', id: 'reportStatus-example-status-slot',
    });
  });

  it('repairs a computed text metadata token from the exact example slot', () => {
    const textPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, exampleText: '2026-08 revenue' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [{ id: 'summary', kind: 'computed' as const, template: '{{meta.periodRange}} revenue' }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'text' as const, id: 'summary' } }],
      tableBindings: [],
    };
    const repaired = repairExampleTextBindings(plan, layout, textPair,
      { scalars: {}, tables: {}, texts: { summary: '2026-08-01 ~ 2026-08-31 revenue' } } as ReportPlanResult,
      { periodRange: '2026-08-01 ~ 2026-08-31', periodYearMonth: '2026-08' });
    expect(repaired.plan.texts[0]).toEqual({
      id: 'summary', kind: 'computed', template: '{{meta.periodYearMonth}} revenue',
    });
  });

  it('does not freeze a numeric or status metadata mismatch into static text', () => {
    const sourcePair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'status-slot', exampleText: '과거 작성 예시' },
        { ...pair.scalarSlots[0]!, id: 'metric-slot', exampleText: '42' },
      ],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'status-slot', value: { kind: 'metadata' as const, key: 'reportStatus' } },
        { slotId: 'metric-slot', value: { kind: 'metadata' as const, key: 'sourceLabel' } },
      ],
      tableBindings: [],
    };

    const repaired = repairExamplePresentationBindings(plan, layout, sourcePair, {
      reportStatus: '검토 필요', sourceLabel: 'source-42',
    });
    expect(repaired.plan.texts).toEqual([]);
    expect(repaired.layout).toEqual(layout);
  });

  it('repairs a period range expression from host metadata when the example proves the exact range', () => {
    const scalarPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, exampleText: '2026-08-01 ~ 2026-08-31' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [],
      scalars: [{ id: 'period', expression: { kind: 'concat' as const, values: [
        { kind: 'field' as const, path: 'meta.periodYearMonth' },
        { kind: 'literal' as const, value: ' ~ ' },
        { kind: 'field' as const, path: 'meta.periodEndInclusive' },
      ] } }], tables: [], texts: [],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'scalar' as const, id: 'period' } }],
      tableBindings: [],
    };

    const repaired = repairExamplePeriodExpressions(plan, layout, scalarPair, {
      periodStart: '2026-08-01', periodEndInclusive: '2026-08-31',
    });
    expect(repaired.scalars[0]?.expression).toEqual({ kind: 'concat', values: [
      { kind: 'field', path: 'meta.periodStart' },
      { kind: 'literal', value: ' ~ ' },
      { kind: 'field', path: 'meta.periodEndInclusive' },
    ] });
  });

  it('repairs a period label text bound to an exact date-range slot', () => {
    const scalarPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, exampleText: '2026-08-01 ~ 2026-08-31' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [{ id: 'period', kind: 'computed' as const, template: '{{meta.periodLabel}}' }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'text' as const, id: 'period' } }],
      tableBindings: [],
    };

    const repaired = repairExamplePeriodExpressions(plan, layout, scalarPair, {
      periodStart: '2026-08-01', periodEndInclusive: '2026-08-31',
    });
    expect(repaired.texts[0]).toEqual({
      id: 'period', kind: 'computed', template: '{{meta.periodStart}} ~ {{meta.periodEndInclusive}}',
    });
  });

  it('repairs a direct period range text that uses the exclusive end token', () => {
    const scalarPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [{ ...pair.scalarSlots[0]!, exampleText: '2026-08-01 ~ 2026-08-31' }],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [{ id: 'period', kind: 'computed' as const,
        template: '{{meta.periodStart}} ~ {{meta.periodEndExclusive}}' }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'period', value: { kind: 'text' as const, id: 'period' } }],
      tableBindings: [],
    };

    const repaired = repairExamplePeriodExpressions(plan, layout, scalarPair, {
      periodStart: '2026-08-01', periodEndInclusive: '2026-08-31', periodEndExclusive: '2026-09-01',
    });
    expect(repaired.texts[0]).toEqual({
      id: 'period', kind: 'computed', template: '{{meta.periodStart}} ~ {{meta.periodEndInclusive}}',
    });
  });

  it('canonicalizes connector-qualified source metadata aliases from the capture contract', () => {
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [
        { id: 'http', kind: 'computed' as const, template: '{{meta.source.http-orders.path}}' },
        { id: 'rdb', kind: 'computed' as const, template: '{{meta.source.rdb-customers.tableName}}' },
      ],
    };
    const repaired = repairReportMetadataReferences(plan, {
      capturePlan: {
        schemaVersion: 1, http: [{ alias: 'orders', connectionId: 'orders-api', path: '/orders', rowsPath: '$' }],
        rdb: [{ alias: 'customers', table: 'public.customers' }],
      },
    });
    expect(repaired.texts).toEqual([
      { id: 'http', kind: 'computed', template: '{{meta.source.orders.path}}' },
      { id: 'rdb', kind: 'computed', template: '{{meta.source.customers.tableName}}' },
    ]);
  });

  it('canonicalizes uniquely matching source alias punctuation across fields and joins', () => {
    const plan = {
      schemaVersion: 1 as const,
      baseSource: 'sales-api',
      joins: [{ source: 'team-roster', left: 'sales-api.owner_id', right: 'owner_id',
        type: 'left' as const, cardinality: 'one' as const }],
      scalars: [{ id: 'owner', expression: { kind: 'first' as const,
        value: { kind: 'field' as const, path: 'team-roster.owner_name' } } }],
      tables: [], texts: [],
    };
    const repaired = repairReportSourceAliases(plan, {
      capturePlan: {
        schemaVersion: 1,
        http: [{ alias: 'sales_api', connectionId: 'sales', path: '/sales', rowsPath: '$' }],
        rdb: [{ alias: 'team_roster', table: 'public.team_roster' }],
      },
    });
    expect(repaired.baseSource).toBe('sales_api');
    expect(repaired.joins[0]?.source).toBe('team_roster');
    expect(repaired.joins[0]?.left).toBe('sales_api.owner_id');
    expect(repaired.scalars[0]?.expression).toEqual({ kind: 'first',
      value: { kind: 'field', path: 'team_roster.owner_name' } });
  });

  it('splits a static text binding when one model id was assigned to unlike example slots', () => {
    const staticPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'note-a', exampleText: '지역별 매출을 큰 순서로 정렬했습니다.' },
        { ...pair.scalarSlots[0]!, id: 'note-b', exampleText: '리스크 계정을 검토했습니다.' },
      ],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [{ id: 'note', kind: 'invariant' as const, value: '리스크 계정을 검토했습니다.' }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'note-a', value: { kind: 'text' as const, id: 'note' } },
        { slotId: 'note-b', value: { kind: 'text' as const, id: 'note' } },
      ], tableBindings: [],
    };
    const repaired = repairStaticTextBindingConflicts(plan, layout, staticPair);
    expect(repaired.layout.scalarBindings).toEqual([
      { slotId: 'note-a', value: { kind: 'text', id: 'note-example-note-a' } },
      { slotId: 'note-b', value: { kind: 'text', id: 'note' } },
    ]);
    expect(repaired.plan.texts).toContainEqual({
      id: 'note-example-note-a', kind: 'invariant', value: '지역별 매출을 큰 순서로 정렬했습니다.',
    });
  });

  it('drops an unknown scalar slot only after every known slot remains bound', () => {
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'known-a', value: { kind: 'metadata' as const, key: 'periodLabel' } },
        { slotId: 'known-b', value: { kind: 'metadata' as const, key: 'reportDate' } },
        { slotId: 'unknown-typo', value: { kind: 'metadata' as const, key: 'reportStatus' } },
      ], tableBindings: [],
    };
    const scalarPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'known-a' },
        { ...pair.scalarSlots[0]!, id: 'known-b' },
      ],
    };
    expect(repairReportScalarBindings(layout, scalarPair).scalarBindings).toEqual(layout.scalarBindings.slice(0, 2));
    const missingKnown = { ...layout, scalarBindings: layout.scalarBindings.filter((binding) => binding.slotId !== 'known-b') };
    expect(repairReportScalarBindings(missingKnown, scalarPair)).toEqual(missingKnown);
  });

  it('splits a computed example sentence across adjacent slots when boundaries align with tokens', () => {
    const fragmentPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'lead', exampleText: '2026-08 인정 매출은 KRW 10입니다. 환불률은' },
        { ...pair.scalarSlots[0]!, id: 'tail', rect: { ...pair.scalarSlots[0]!.rect, y: 12 }, exampleText: '5.00%입니다.' },
      ],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [
        { id: 'revenue', expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } }, format: { style: 'currency' as const, currency: 'KRW', decimals: 0 } },
        { id: 'rate', expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.rate' } }, format: { style: 'percent' as const, decimals: 2 } },
      ], tables: [], texts: [{ id: 'summary', kind: 'computed' as const,
        template: '{{meta.periodYearMonth}} 인정 매출은 {{scalar.revenue}}입니다. 환불률은 {{scalar.rate}}입니다.' }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'lead', value: { kind: 'text' as const, id: 'summary' } },
        { slotId: 'tail', value: { kind: 'text' as const, id: 'summary' } },
      ], tableBindings: [],
    };

    const repaired = repairExampleTextFragments(plan, layout, fragmentPair, {
      scalars: {
        revenue: { raw: 10, display: 'KRW 10' }, rate: { raw: 0.05, display: '5.00%' },
      }, tables: {}, texts: { summary: '2026-08 인정 매출은 KRW 10입니다. 환불률은 5.00%입니다.' },
    }, { periodYearMonth: '2026-08' });
    expect(repaired.layout.scalarBindings.map((binding) => binding.value)).toEqual([
      { kind: 'text', id: 'summary-lead' }, { kind: 'text', id: 'summary-tail' },
    ]);
    expect(repaired.plan.texts).toContainEqual({ id: 'summary-lead', kind: 'computed',
      template: '{{meta.periodYearMonth}} 인정 매출은 {{scalar.revenue}}입니다. 환불률은' });
    expect(repaired.plan.texts).toContainEqual({ id: 'summary-tail', kind: 'computed',
      template: '{{scalar.rate}}입니다.' });
  });

  it('splits a computed sentence after correcting a metadata display shape', () => {
    const fragmentPair: PdfReportPairAnalysis = {
      ...pair,
      scalarSlots: [
        { ...pair.scalarSlots[0]!, id: 'lead', exampleText: '2026-08 인정 매출은 KRW 10입니다. 환불률은' },
        { ...pair.scalarSlots[0]!, id: 'tail', rect: { ...pair.scalarSlots[0]!.rect, y: 12 }, exampleText: '5.00%입니다.' },
      ],
    };
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [
        { id: 'revenue', expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.amount' } }, format: { style: 'currency' as const, currency: 'KRW', decimals: 0 } },
        { id: 'rate', expression: { kind: 'sum' as const, value: { kind: 'field' as const, path: 'orders.rate' } }, format: { style: 'percent' as const, decimals: 2 } },
      ], tables: [], texts: [{ id: 'summary', kind: 'computed' as const,
        template: '{{meta.periodRange}} 인정 매출은 {{scalar.revenue}}입니다. 환불률은 {{scalar.rate}}입니다.' }],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [
        { slotId: 'lead', value: { kind: 'text' as const, id: 'summary' } },
        { slotId: 'tail', value: { kind: 'text' as const, id: 'summary' } },
      ], tableBindings: [],
    };

    const repaired = repairExampleTextFragments(plan, layout, fragmentPair, {
      scalars: {
        revenue: { raw: 10, display: 'KRW 10' }, rate: { raw: 0.05, display: '5.00%' },
      }, tables: {}, texts: { summary: '2026-08-01 ~ 2026-08-31 인정 매출은 KRW 10입니다. 환불률은 5.00%입니다.' },
    }, { periodRange: '2026-08-01 ~ 2026-08-31', periodYearMonth: '2026-08' });
    expect(repaired.plan.texts).toContainEqual({ id: 'summary-lead', kind: 'computed',
      template: '{{meta.periodYearMonth}} 인정 매출은 {{scalar.revenue}}입니다. 환불률은' });
    expect(repaired.plan.texts).toContainEqual({ id: 'summary-tail', kind: 'computed',
      template: '{{scalar.rate}}입니다.' });
  });

  it('drops text records that have no physical layout binding', () => {
    const plan = {
      schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [], tables: [],
      texts: [
        { id: 'used', kind: 'invariant' as const, value: 'Observed wording.' },
        { id: 'unused', kind: 'invariant' as const, value: 'Optional model note.' },
      ],
    };
    const layout = {
      schemaVersion: 1 as const, outputFileName: 'report.pdf',
      scalarBindings: [{ slotId: 'note', value: { kind: 'text' as const, id: 'used' } }],
      tableBindings: [],
    };
    expect(pruneUnboundReportTexts(plan, layout).texts).toEqual([plan.texts[0]]);
  });

  it('preserves omitted report structure and layout bindings during revision', () => {
    const previous = {
      schemaVersion: 1 as const,
      reportPlan: {
        schemaVersion: 1 as const, baseSource: 'orders', joins: [],
        datasets: [{ id: 'sales', baseSource: 'orders', joins: [], filter: { kind: 'compare' as const,
          operation: 'gte' as const, left: { kind: 'field' as const, path: 'orders.created_at' },
          right: { kind: 'field' as const, path: 'meta.periodStart' } } }],
        scalars: [{ id: 'kept', expression: { kind: 'count' as const } }], tables: [],
        texts: [{ id: 'note', kind: 'invariant' as const, value: 'Reviewed source data only.' }],
      },
      layout: {
        schemaVersion: 1 as const, outputFileName: 'report.pdf',
        scalarBindings: [
          { slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } },
          { slotId: 'note-slot', value: { kind: 'text' as const, id: 'note' } },
        ],
        tableBindings: [],
      },
    };
    const next = {
      schemaVersion: 1 as const,
      reportPlan: {
        schemaVersion: 1 as const, baseSource: 'orders', joins: [],
        scalars: [{ id: 'replacement', expression: { kind: 'count' as const } }], tables: [], texts: [],
      },
      layout: {
        schemaVersion: 1 as const, outputFileName: 'report.pdf',
        scalarBindings: [{ slotId: 'period', value: { kind: 'metadata' as const, key: 'periodLabel' } }],
        tableBindings: [],
      },
    };

    const merged = mergeReportBusinessInference(previous, next);
    expect(merged.reportPlan.scalars.map((scalar) => scalar.id)).toEqual(['replacement', 'kept']);
    expect(merged.reportPlan.datasets).toEqual(previous.reportPlan.datasets);
    expect(merged.reportPlan.texts).toEqual(previous.reportPlan.texts);
    expect(merged.layout.scalarBindings).toEqual([
      ...next.layout.scalarBindings,
      previous.layout.scalarBindings[1],
    ]);
  });

  it('carries omitted view projection and ordering options across a revision', () => {
    const previous = {
      schemaVersion: 1 as const,
      reportPlan: {
        schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [],
        tables: [{
          kind: 'view' as const, id: 'riskAccounts', sourceTable: 'customerPerformance',
          filter: { kind: 'compare' as const, operation: 'lt' as const,
            left: { kind: 'column' as const, columnId: 'attainment' },
            right: { kind: 'literal' as const, value: 0.6 } },
          columns: ['customer', 'manager', 'attainment'],
          sort: [{ columnId: 'attainment', direction: 'desc' as const }], limit: 5,
        }], texts: [],
      },
      layout: {
        schemaVersion: 1 as const, outputFileName: 'report.pdf', scalarBindings: [], tableBindings: [],
      },
    };
    const next = {
      schemaVersion: 1 as const,
      reportPlan: {
        schemaVersion: 1 as const, baseSource: 'orders', joins: [], scalars: [],
        tables: [{ kind: 'view' as const, id: 'riskAccounts', sourceTable: 'customerPerformance' }], texts: [],
      },
      layout: {
        schemaVersion: 1 as const, outputFileName: 'report.pdf', scalarBindings: [], tableBindings: [],
      },
    };

    const merged = mergeReportBusinessInference(previous, next);
    expect(merged.reportPlan.tables[0]).toEqual(previous.reportPlan.tables[0]);
  });

  it('rejects a scalar whose value is copied from the example instead of derived from data', async () => {
    const runner = fakeRunner([]);
    const original = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      const response = await original(request);
      if (request.logContext?.startsWith('report-business-plan')) {
        const output = response.output as {
          reportPlan: { scalars: Array<Record<string, unknown>> };
        };
        output.reportPlan.scalars[0]!.expression = {
          kind: 'first',
          value: { kind: 'literal', value: 17 },
        };
      }
      return response;
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({
      goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });

    await expect(planner.inferReportPlan({
      goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'o1' }] } },
      connectedConnectors: ['http'],
    })).rejects.toThrow('report_plan_output_not_source_derived:scalar.orderCount');
  });

  it('rejects an example-period date copied into the reusable report plan', async () => {
    const runner = fakeRunner([]);
    const original = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      const response = await original(request);
      if (request.logContext?.startsWith('report-business-plan')) {
        const output = response.output as {
          reportPlan: Record<string, unknown>;
        };
        output.reportPlan.filter = {
          kind: 'compare',
          operation: 'gte',
          left: { kind: 'field', path: 'orders.created_at' },
          right: { kind: 'literal', value: '2026-08-01' },
        };
      }
      return response;
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({
      goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });

    await expect(planner.inferReportPlan({
      goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'o1' }] } },
      connectedConnectors: ['http'],
    })).rejects.toThrow('report_plan_period_literal_forbidden:2026-08-01');
  });

  it('rejects a target-period filename copied into the layout plan', async () => {
    const runner = fakeRunner([]);
    const original = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      const response = await original(request);
      if (request.logContext === 'report-layout-plan') {
        const output = response.output as { layout: { outputFileName: string } };
        output.layout.outputFileName = '2026-09-report.pdf';
      }
      return response;
    };
    const planner = new ReportPlanner(runner, { readImage: () => new Uint8Array([1]) });
    const capture = await planner.inferCapturePlan({
      goal: 'report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });

    await expect(planner.inferReportPlan({
      goal: 'report', pair, capture,
      exampleSources: { orders: { id: 'orders', complete: true, rows: [{ id: 'o1' }] } },
      connectedConnectors: ['http'],
    })).rejects.toThrow('report_plan_period_literal_forbidden:2026-09');
  });
});

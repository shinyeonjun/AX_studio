import { describe, expect, it } from 'vitest';
import type { InvestigationRunRequest, InvestigationRunner } from '../../agent/investigation-runner.js';
import { zodToCodexJsonSchema } from '../../agent/model/cli-json.js';
import type { PdfReportPairAnalysis } from '../../document-engine/types/pdf.js';
import type { ReportSourceSnapshot } from '../plan/schema.js';
import { ReportPlanner } from './planner.js';
import { ReportBusinessInferenceSchema } from './schema.js';

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

function fakeRunner(seen: Array<InvestigationRunRequest<unknown>>): InvestigationRunner {
  return {
    providerName: 'fixture',
    async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request as InvestigationRunRequest<unknown>);
      const captureOutput = {
          schemaVersion: 1,
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
      return { output: request.outputSchema.parse(output) };
    },
  };
}

describe('ReportPlanner', () => {
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
    expect(seen.every((request) => request.images?.length === 2)).toBe(true);
    expect(seen.flatMap((request) => request.images ?? []).map((image) => image.filename)).toEqual([
      'template-page-1.png', 'example-page-1.png',
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
      if (request.logContext === 'report-business-plan') {
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
    const capture = await planner.inferCapturePlan({
      goal: 'next report', pair,
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/' }],
      rdbTables: [], connectedConnectors: ['http'],
    });
    const exampleSources = { orders: { id: 'orders', complete: true, rows: [{ id: 'row-a' }] } };
    const previous = await planner.inferReportPlan({
      goal: 'next report', pair, capture, exampleSources, connectedConnectors: ['http'],
    });

    const revised = await planner.reviseReportPlan({
      goal: 'next report', pair, capture, exampleSources, previous,
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
  });

  it('rejects a scalar whose value is copied from the example instead of derived from data', async () => {
    const runner = fakeRunner([]);
    const original = runner.run.bind(runner);
    runner.run = async <T>(request: InvestigationRunRequest<T>) => {
      const response = await original(request);
      if (request.logContext === 'report-business-plan') {
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
      if (request.logContext === 'report-business-plan') {
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

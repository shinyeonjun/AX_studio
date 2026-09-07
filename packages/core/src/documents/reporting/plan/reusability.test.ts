import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { ReportLayoutPlanSchema, type ReportLayoutPlan } from '../layout/schema.js';
import { reportExecutionMetadata, renderReportMetadataTemplate } from '../period-metadata.js';
import { executeReportPlan } from './execute.js';
import { assertReusableReportPlan, assertReusableReportPresentation } from './reusability.js';
import { ReportPlanSchema } from './schema.js';
import type { ReportPlan } from './schema.js';

const periods = {
  examplePeriod: { start: '2034-02-01', endInclusive: '2034-02-28', label: 'February 2034' },
  targetPeriod: { start: '2034-03-01', endInclusive: '2034-03-31', label: 'March 2034' },
};

const pair: PdfReportPairAnalysis = {
  schemaVersion: 1,
  pairId: 'pair',
  templateHash: 'template',
  exampleHash: 'example',
  pageCount: 1,
  pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
  scalarSlots: [
    { id: 'note', pageIndex: 0, rect: { x: 10, y: 10, width: 100, height: 12 }, exampleText: 'Reviewed source data only.', fontSize: 10, font: 'Fixture', color: 0 },
    { id: 'status', pageIndex: 0, rect: { x: 10, y: 30, width: 100, height: 12 }, exampleText: 'Historical example', fontSize: 10, font: 'Fixture', color: 0 },
    { id: 'source', pageIndex: 0, rect: { x: 10, y: 50, width: 100, height: 12 }, exampleText: 'GET /records/v4', fontSize: 10, font: 'Fixture', color: 0 },
  ],
  tableGroups: [],
  templateImages: [],
  exampleImages: [],
};

const plan: ReportPlan = {
  schemaVersion: 1,
  baseSource: 'ledger',
  joins: [],
  scalars: [{ id: 'count', expression: { kind: 'count' } }],
  tables: [],
  texts: [
    { id: 'note', kind: 'invariant', value: 'Reviewed source data only.' },
    { id: 'status', kind: 'phase', exampleValue: 'Historical example', targetMetadataKey: 'reportStatus' },
    { id: 'source', kind: 'computed', template: 'GET {{meta.source.ledger.path}}' },
  ],
};

const layout: ReportLayoutPlan = {
  schemaVersion: 1,
  outputFileName: 'report-{{meta.periodYear}}-{{meta.periodMonthPadded}}.pdf',
  scalarBindings: [
    { slotId: 'note', value: { kind: 'text', id: 'note' } },
    { slotId: 'status', value: { kind: 'text', id: 'status' } },
    { slotId: 'source', value: { kind: 'text', id: 'source' } },
  ],
  tableBindings: [],
};

const capturePlan = {
  schemaVersion: 1 as const,
  http: [{ alias: 'ledger', connectionId: 'host-secret-reference', path: '/records/v4', rowsPath: 'items' }],
  rdb: [],
};

describe('report plan reusability', () => {
  it('keeps invariant prose, derives source identity, and changes phase status without copying data', () => {
    expect(() => assertReusableReportPlan(plan, periods)).not.toThrow();
    expect(() => assertReusableReportPresentation(plan, layout, pair, periods)).not.toThrow();

    const example = executeReportPlan(plan, {
      ledger: { id: 'ledger', complete: true, rows: [{ arbitrary: 1 }] },
    }, reportExecutionMetadata(periods.examplePeriod, capturePlan, 'example'));
    const targetMetadata = reportExecutionMetadata(periods.targetPeriod, capturePlan, 'target');
    const target = executeReportPlan(plan, {
      ledger: { id: 'ledger', complete: true, rows: [{ arbitrary: 2 }] },
    }, targetMetadata);

    expect(example.texts).toMatchObject({
      note: 'Reviewed source data only.',
      status: 'Historical example',
      source: 'GET /records/v4',
    });
    expect(target.texts).toMatchObject({
      note: 'Reviewed source data only.',
      status: '검토 필요',
      source: 'GET /records/v4',
    });
    expect(renderReportMetadataTemplate(layout.outputFileName, targetMetadata)).toBe('report-2034-03.pdf');
    expect(JSON.stringify(targetMetadata)).not.toContain('host-secret-reference');
    expect(JSON.stringify(targetMetadata)).not.toContain('items');
  });

  it('provides a stable year-month metadata token for computed report text', () => {
    const periodText: ReportPlan = {
      ...plan,
      texts: [{ id: 'period', kind: 'computed', template: '{{meta.periodYearMonth}}' }],
    };
    const result = executeReportPlan(periodText, {
      ledger: { id: 'ledger', complete: true, rows: [{ arbitrary: 1 }] },
    }, reportExecutionMetadata(periods.targetPeriod, capturePlan, 'target'));

    expect(result.texts.period).toBe('2034-03');
  });

  it('rejects a numeric example value disguised as invariant prose', () => {
    const copied: ReportPlan = {
      ...plan,
      texts: [{ id: 'copied', kind: 'invariant', value: 'Revenue 987654' }],
    };
    expect(() => assertReusableReportPlan(copied, periods))
      .toThrow('report_plan_static_text_data_forbidden:text.copied');
  });

  it('accepts metadata-backed value expressions in scalar slots', () => {
    const metadataScalar: ReportPlan = {
      ...plan,
      scalars: [{
        id: 'period',
        expression: {
          kind: 'concat',
          values: [
            { kind: 'field', path: 'meta.periodLabel' },
            { kind: 'literal', value: ' report' },
          ],
        },
      }],
    };
    expect(() => assertReusableReportPlan(metadataScalar, periods)).not.toThrow();
  });

  it('promotes nonnumeric tokenless computed prose to invariant text', () => {
    const parsed = ReportPlanSchema.parse({
      ...plan,
      texts: [{ id: 'note', kind: 'computed', template: 'Reviewed source data only.' }],
    });

    expect(parsed.texts).toEqual([{ id: 'note', kind: 'invariant', value: 'Reviewed source data only.' }]);
    expect(() => assertReusableReportPlan(parsed, periods)).not.toThrow();
  });

  it('normalizes declared scalar references written without a namespace', () => {
    const parsed = ReportPlanSchema.parse({
      ...plan,
      scalars: [
        { id: 'period', expression: { kind: 'field', path: 'meta.periodLabel' } },
        { id: 'count', expression: { kind: 'count' } },
      ],
      texts: [{ id: 'summary', kind: 'computed', template: '{{period}}: {{count}}건' }],
    });

    expect(parsed.texts).toEqual([{
      id: 'summary',
      kind: 'computed',
      template: '{{scalar.period}}: {{scalar.count}}건',
    }]);
  });

  it('normalizes bare period metadata tokens in output filenames', () => {
    const parsed = ReportLayoutPlanSchema.parse({
      ...layout,
      outputFileName: 'report-{{periodYear}}-{{periodMonthPadded}}.pdf',
    });

    expect(parsed.outputFileName).toBe('report-{{meta.periodYear}}-{{meta.periodMonthPadded}}.pdf');
  });

  it('normalizes metadata namespace aliases in output filenames', () => {
    const parsed = ReportLayoutPlanSchema.parse({
      ...layout,
      outputFileName: 'report-{{metadata.periodYear}}-{{metadata.periodMonthPadded}}.pdf',
    });

    expect(parsed.outputFileName).toBe('report-{{meta.periodYear}}-{{meta.periodMonthPadded}}.pdf');
  });

  it('normalizes field-wrapped metadata tokens in output filenames', () => {
    const parsed = ReportLayoutPlanSchema.parse({
      ...layout,
      outputFileName: 'report-{{field:meta.periodYear}}-{{field:meta.periodMonthPadded}}.pdf',
    });

    expect(parsed.outputFileName).toBe('report-{{meta.periodYear}}-{{meta.periodMonthPadded}}.pdf');
  });

  it('allows nonnumeric static scalar prose as presentation metadata', () => {
    const sourceSummary: ReportPlan = {
      ...plan,
      scalars: [{ id: 'sourceSummary', expression: {
        kind: 'literal', value: 'REST 주문 + PostgreSQL CRM',
      }, format: { style: 'text' } }],
    };
    expect(() => assertReusableReportPlan(sourceSummary, periods)).not.toThrow();
  });

  it('rejects invariant prose that was not present in its bound example slot', () => {
    const invented: ReportPlan = {
      ...plan,
      texts: plan.texts.map((text) => text.id === 'note'
        ? { id: 'note', kind: 'invariant' as const, value: 'Invented wording.' }
        : text),
    };
    expect(() => assertReusableReportPresentation(invented, layout, pair, periods))
      .toThrow('report_plan_static_text_not_from_example:note');
  });
});

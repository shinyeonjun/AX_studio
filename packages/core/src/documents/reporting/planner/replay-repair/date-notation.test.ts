import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../../layout/schema.js';
import { repairExampleReplayInference } from '../replay-repair.js';

const slot = (id: string, exampleText: string) => ({ id, pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, exampleText, fontSize: 10, font: '', color: 0 });
const pair: PdfReportPairAnalysis = {
  schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1, pages: [],
  scalarSlots: [slot('range', '2026.08.01 ~ 2026.08.31'), slot('sentence', '8월 총매출은 1,800원입니다')],
  tableGroups: [], templateImages: [], exampleImages: [],
};
const metadata = { periodStart: '2026-08-01', periodEndInclusive: '2026-08-31', periodRange: '2026-08-01 ~ 2026-08-31' };

describe('a date the example writes its own way', () => {
  it('is written with the example notation from the period metadata, never as a frozen date', () => {
    const layout: ReportLayoutPlan = {
      schemaVersion: 1, outputFileName: 'report',
      scalarBindings: [
        { slotId: 'range', value: { kind: 'metadata', key: 'periodRange' } },
        { slotId: 'sentence', value: { kind: 'text', id: 'summary' } },
      ],
      tableBindings: [],
    };
    const repaired = repairExampleReplayInference({
      plan: {
        schemaVersion: 1, baseSource: 'sales', joins: [],
        scalars: [{ id: 'total', kind: 'aggregate', expression: { kind: 'sum', value: { kind: 'field', path: 'sales.amount' } }, format: { style: 'currency', currency: 'KRW', decimals: 0, suffix: '원' } }],
        tables: [],
        texts: [{ id: 'summary', kind: 'computed', template: '{{meta.periodRange}} 총매출은 {{scalar.total}}입니다' }],
      } as never,
      layout, pair, metadata,
      sources: { sales: { id: 'sales', complete: true, rows: [{ amount: 1800 }] } } as never,
    });
    expect(repaired.mismatches).toEqual([]);
    const texts = Object.fromEntries(repaired.plan.texts.map((text) => [text.id, text.kind === 'computed' ? text.template : '']));
    expect(Object.values(texts)).toContain('{{meta.periodStart|YYYY.MM.DD}} ~ {{meta.periodEndInclusive|YYYY.MM.DD}}');
    expect(texts.summary).toBe('{{meta.periodStart|M월}} 총매출은 {{scalar.total}}입니다');
  });
});

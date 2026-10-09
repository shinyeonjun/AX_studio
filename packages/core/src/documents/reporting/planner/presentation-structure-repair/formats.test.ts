import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../../layout/schema.js';
import type { ReportPlan } from '../../plan/schema.js';
import { inferReportFormats } from './formats.js';

const slot = (id: string, exampleText: string) => ({ id, pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, exampleText, fontSize: 10, font: '', color: 0 });

function formatFor(exampleText: string, format: NonNullable<ReportPlan['scalars'][number]['format']>) {
  const pair = { scalarSlots: [slot('s', exampleText)], tableGroups: [] } as unknown as PdfReportPairAnalysis;
  const layout = { scalarBindings: [{ slotId: 's', value: { kind: 'scalar', id: 'x' } }], tableBindings: [] } as unknown as ReportLayoutPlan;
  const plan = { scalars: [{ id: 'x', expression: { kind: 'count' }, format }], tables: [] } as unknown as ReportPlan;
  return inferReportFormats(plan, layout, pair).scalars[0]!.format;
}

describe('the example decides how a value is written', () => {
  it('drops an affix the example does not show, keeps one it does', () => {
    expect(formatFor('12,623,600', { style: 'currency', currency: 'KRW', prefix: '₩' })).toEqual({ style: 'integer' });
    expect(formatFor('28.5분', { style: 'text' })).toEqual({ style: 'decimal', decimals: 1, suffix: '분' });
    expect(formatFor('126건', { style: 'integer' })).toEqual({ style: 'integer', suffix: '건' });
  });
});

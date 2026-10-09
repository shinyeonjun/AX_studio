import { describe, expect, it } from 'vitest';
import { formatReportDate, renderReportTextTemplate } from './text-tokens.js';

const values = {
  scalars: { revenue: { display: '8,466,900원' } },
  tables: { categories: { rows: [
    { display: { name: '전자기기', share: '47.7%' } },
    { display: { name: '식품', share: '32.0%' } },
  ] } },
  metadata: { periodStart: '2026-08-01', periodEndInclusive: '2026-08-31', periodYearMonth: '2026-08' },
};

describe('computed report text tokens', () => {
  it('writes a period date the way the example does', () => {
    expect(renderReportTextTemplate('{{meta.periodStart|YYYY.MM.DD}} ~ {{meta.periodEndInclusive|YYYY.MM.DD}}', values))
      .toBe('2026.08.01 ~ 2026.08.31');
    expect(renderReportTextTemplate('{{meta.periodStart|M}}월 총매출은 {{scalar.revenue}}', values)).toBe('8월 총매출은 8,466,900원');
    expect(formatReportDate('2026-08', 'YYYY년 M월')).toBe('2026년 8월');
    expect(formatReportDate('2026-08-05', 'YY/M/D')).toBe('26/8/5');
  });

  it('reads one cell of a table row, counted from 1 after the table sort', () => {
    expect(renderReportTextTemplate('1위는 {{table.categories.row1.name}}({{table.categories.row1.share}})', values))
      .toBe('1위는 전자기기(47.7%)');
  });

  it('fails closed on a row the table does not have, or a pattern on a value that is not a date', () => {
    expect(() => renderReportTextTemplate('{{table.categories.row3.name}}', values)).toThrow('report_text_reference_missing');
    expect(() => renderReportTextTemplate('{{scalar.revenue|YYYY}}', values)).toThrow('report_text_reference_missing');
    expect(() => renderReportTextTemplate('{{meta.periodYearMonth|D일}}', values)).toThrow('report_text_reference_invalid');
    expect(() => renderReportTextTemplate('{{metadata:periodStart}}', values)).toThrow('report_text_reference_invalid');
  });
});

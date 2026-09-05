import type { ReportPrimitive } from './plan/schema.js';
import type { ReportPeriod, ReportSourceCapturePlan } from './source/schema.js';

function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) throw new Error('report_period_invalid');
  return { year, month, day };
}

function followingDate(value: string): string {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function unqualifiedTableName(value: string): string {
  return value.split('.').filter(Boolean).at(-1) ?? value;
}

/** Stable host-computed period variants keep date formatting out of learned business math. */
export function reportPeriodMetadata(period: ReportPeriod): Record<string, ReportPrimitive> {
  const start = dateParts(period.start);
  const end = dateParts(period.endInclusive);
  const next = followingDate(period.endInclusive);
  const reportDate = dateParts(next);
  return {
    periodLabel: period.label,
    periodStart: period.start,
    periodEndInclusive: period.endInclusive,
    periodEndExclusive: next,
    periodYear: start.year,
    periodMonth: start.month,
    periodMonthPadded: String(start.month).padStart(2, '0'),
    periodTitleKorean: `${start.year}년 ${start.month}월`,
    periodStartKorean: `${start.year}년 ${start.month}월 ${start.day}일`,
    periodEndKorean: `${end.year}년 ${end.month}월 ${end.day}일`,
    periodStartDot: `${start.year}. ${start.month}. ${start.day}.`,
    periodEndDot: `${end.year}. ${end.month}. ${end.day}.`,
    reportDate: next,
    reportDateKorean: `${reportDate.year}년 ${reportDate.month}월 ${reportDate.day}일`,
    reportDateDot: `${reportDate.year}. ${reportDate.month}. ${reportDate.day}.`,
  };
}

/**
 * Adds only host-owned source identity and run-state metadata. Source rows,
 * credentials, connection ids, and parser paths never enter this object.
 */
export function reportExecutionMetadata(
  period: ReportPeriod,
  capturePlan: ReportSourceCapturePlan,
  phase: 'example' | 'target',
): Record<string, ReportPrimitive> {
  const metadata = reportPeriodMetadata(period);
  metadata.reportPhase = phase;
  metadata.reportStatus = phase === 'target' ? '검토 필요' : 'example';
  metadata.httpSourcePaths = capturePlan.http.map((source) => source.path).join(' / ');
  metadata.rdbSourceTables = capturePlan.rdb.map((source) => source.table).join(' / ');
  metadata.rdbSourceTableNames = capturePlan.rdb.map((source) => unqualifiedTableName(source.table)).join(' / ');
  metadata.httpSourceCount = capturePlan.http.length;
  metadata.rdbSourceCount = capturePlan.rdb.length;
  for (const source of capturePlan.http) {
    metadata[`source.${source.alias}.path`] = source.path;
  }
  for (const source of capturePlan.rdb) {
    metadata[`source.${source.alias}.table`] = source.table;
    metadata[`source.${source.alias}.tableName`] = unqualifiedTableName(source.table);
  }
  return metadata;
}

export function renderReportMetadataTemplate(
  template: string,
  metadata: Record<string, ReportPrimitive>,
): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (!token.startsWith('meta.')) throw new Error(`report_metadata_template_token_invalid:${token}`);
    const key = token.slice('meta.'.length);
    const value = metadata[key];
    if (value === undefined) throw new Error(`report_metadata_template_value_missing:${key}`);
    return String(value ?? '');
  });
}

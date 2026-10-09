import type { ReportPrimitive } from './schema.js';

/**
 * Tokens a computed report text may hold. One grammar for computing and for repairing texts:
 *   {{scalar.<id>}}                     a scalar as displayed
 *   {{meta.<key>}}                      period metadata
 *   {{meta.<key>|<date pattern>}}       a date written the report's way: YYYY YY MM M DD D
 *                                       ("YYYY.MM.DD" → 2026.08.01, "M월" → 8월, "YYYY년 M월" → 2026년 8월)
 *   {{table.<id>.rowCount}}             how many rows a table has
 *   {{table.<id>.row<N>.<columnId>}}    one cell as displayed, N from 1 (the top row after sorting)
 */
export const REPORT_TEXT_TOKEN_GRAMMAR = '{{scalar.<id>}}, {{meta.<key>}}, '
  + '{{meta.<dateKey>|<pattern>}} with YYYY, YY, MM, M, DD, D (for example {{meta.periodStart|YYYY.MM.DD}} or {{meta.periodStart|M월}}), '
  + '{{table.<tableId>.rowCount}} or {{table.<tableId>.row<N>.<columnId>}} (N from 1, after the table\'s sort)';

export interface ReportTextValues {
  scalars: Record<string, { display: string }>;
  tables: Record<string, { rows: Array<{ display: Record<string, string> }> }>;
  metadata: Record<string, ReportPrimitive>;
}

const DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u;

/** A YYYY-MM(-DD) date in the pattern's shape; undefined when the value is not such a date. */
export function formatReportDate(value: string, pattern: string): string | undefined {
  const match = DATE.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (day === undefined && /D/u.test(pattern)) return undefined;
  const parts: Record<string, string> = {
    YYYY: year!, YY: year!.slice(2), MM: month!, M: String(Number(month)),
    DD: day ?? '', D: day === undefined ? '' : String(Number(day)),
  };
  return pattern.replace(/YYYY|YY|MM|M|DD|D/gu, (part) => parts[part]!);
}

/** The token's text, or undefined when it names nothing that exists. Throws on a token outside the grammar. */
export function renderReportTextToken(rawToken: string, values: ReportTextValues): string | undefined {
  const token = rawToken.trim();
  if (token.startsWith('scalar.')) return values.scalars[token.slice('scalar.'.length)]?.display;
  if (token.startsWith('meta.')) {
    const [key, pattern] = token.slice('meta.'.length).split('|', 2).map((part) => part.trim());
    const value = values.metadata[key!];
    if (value === undefined) return undefined;
    if (pattern === undefined) return String(value ?? '');
    const formatted = formatReportDate(String(value ?? ''), pattern);
    if (formatted === undefined) throw new Error(`report_text_reference_invalid:${token}`);
    return formatted;
  }
  const count = /^table\.([^.]+)\.rowCount$/u.exec(token);
  if (count) {
    const table = values.tables[count[1]!];
    return table ? String(table.rows.length) : undefined;
  }
  const cell = /^table\.([^.]+)\.row([1-9]\d*)\.(.+)$/u.exec(token);
  if (cell) return values.tables[cell[1]!]?.rows[Number(cell[2]) - 1]?.display[cell[3]!];
  throw new Error(`report_text_reference_invalid:${token}`);
}

export function renderReportTextTemplate(template: string, values: ReportTextValues): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (_match, token: string) => {
    const rendered = renderReportTextToken(token, values);
    if (rendered === undefined) throw new Error(`report_text_reference_missing:${token.trim()}`);
    return rendered;
  });
}

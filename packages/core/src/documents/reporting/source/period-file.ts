import type { ReportPeriod } from './schema.js';

function yearMonth(period: ReportPeriod): { year: number; month: number } {
  const [year, month] = period.start.split('-').map(Number);
  return { year: year!, month: month! };
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * Another period's file in a one-file-per-period family: the digits that spell the example
 * period's year and month are replaced by that period's ("매출_2026-08.xlsx" -> "매출_2026-09.xlsx",
 * "2026/8월 매출.csv" -> "2026/9월 매출.csv"). Digits that do not spell the period (a version, a
 * day) stay. A name that does not show its period fails: the right file cannot be told then.
 */
export function periodFilePath(examplePath: string, examplePeriod: ReportPeriod, period: ReportPeriod): string {
  const from = yearMonth(examplePeriod);
  const to = yearMonth(period);
  if (from.year === to.year && from.month === to.month) return examplePath;
  const runs = [...examplePath.matchAll(/\d+/gu)].map((match) => ({ text: match[0], index: match.index! }));
  const replacement = new Map<number, string>();
  let previousWasYear = false;
  const monthRuns = runs.filter((run) => run.text === pad2(from.month) || run.text === String(from.month));
  for (const run of runs) {
    let next: string | undefined;
    if (run.text === `${from.year}${pad2(from.month)}`) next = `${to.year}${pad2(to.month)}`;
    else if (run.text === `${pad2(from.year % 100)}${pad2(from.month)}` && run.text.length === 4 && !runs.some((other) => other.text === String(from.year))) {
      next = `${pad2(to.year % 100)}${pad2(to.month)}`;
    } else if (run.text === String(from.year)) next = String(to.year);
    else if ((run.text === pad2(from.month) || run.text === String(from.month))
      && (previousWasYear || (monthRuns.length === 1 && !runs.some((other) => other.text === String(from.year))))) {
      next = run.text.length === 2 ? pad2(to.month) : String(to.month);
    }
    if (next !== undefined) replacement.set(run.index, next);
    previousWasYear = run.text === String(from.year);
  }
  const touchesMonth = [...replacement.values()].length > 0
    && (from.month === to.month || runs.some((run) => replacement.has(run.index) && run.text !== String(from.year)));
  if (!touchesMonth) throw new Error('report_file_period_name_unknown');
  let result = '';
  let cursor = 0;
  for (const run of runs) {
    const next = replacement.get(run.index);
    if (next === undefined) continue;
    result += examplePath.slice(cursor, run.index) + next;
    cursor = run.index + run.text.length;
  }
  return result + examplePath.slice(cursor);
}

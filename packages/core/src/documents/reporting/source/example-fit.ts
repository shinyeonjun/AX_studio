import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';

/**
 * How many of the completed report's numbers a candidate table can produce with plain totals:
 * row counts, sums, distinct counts, per-group counts and sums, each also without one value of a
 * small label column (a status such as 취소). Only the counts leave the host, never a value, so
 * a model choosing between two similar files can use the example as the judge instead of asking.
 */
export interface ExampleFit {
  exampleNumbersExplained: number;
  exampleNumbersTested: number;
}

const MAX_COLUMNS = 30;
const MAX_LABEL_VALUES = 12;
const MAX_GROUPS = 400;

function displayed(text: string): number | undefined {
  if (!/\d/u.test(text) || /\d{4}[-./년]\s*\d/u.test(text)) return undefined;
  const value = Number(text.replace(/[^\d.-]/gu, ''));
  return Number.isFinite(value) ? value : undefined;
}

export function exampleNumbers(pair: PdfReportPairAnalysis): number[] {
  const texts = [
    ...pair.scalarSlots.map((slot) => slot.exampleText),
    ...pair.tableGroups.flatMap((group) => group.rows.flatMap((row) => row.cells.map((cell) => cell.exampleText))),
  ];
  // Small numbers (ranks, 1–9) match by chance; they say nothing about which source it is.
  return [...new Set(texts.map(displayed).filter((value): value is number => value !== undefined && Math.abs(value) >= 10))]
    .slice(0, 300);
}

export function exampleFit(rows: Array<Record<string, unknown>>, columnNames: string[], targets: number[]): ExampleFit {
  if (targets.length === 0) return { exampleNumbersExplained: 0, exampleNumbersTested: 0 };
  const columns = columnNames.slice(0, MAX_COLUMNS);
  const numeric = columns.filter((column) => rows.some((row) => typeof row[column] === 'number'));
  const labels = columns.filter((column) => !numeric.includes(column)).filter((column) => {
    const values = new Set(rows.map((row) => String(row[column] ?? '')));
    return values.size > 1 && values.size <= MAX_GROUPS;
  });
  const produced = new Set<number>();
  const add = (value: number) => {
    if (Number.isFinite(value)) produced.add(Math.round(value * 100) / 100);
  };
  const totals = (subset: Array<Record<string, unknown>>) => {
    add(subset.length);
    for (const column of numeric) {
      const values = subset.map((row) => row[column]).filter((value): value is number => typeof value === 'number');
      const sum = values.reduce((total, value) => total + value, 0);
      add(sum);
      if (values.length > 0) add(Math.round(sum / values.length));
    }
    for (const column of columns) add(new Set(subset.map((row) => JSON.stringify(row[column] ?? null))).size);
    for (const label of labels) {
      const groups = new Map<string, Array<Record<string, unknown>>>();
      for (const row of subset) {
        const key = String(row[label] ?? '');
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
      }
      if (groups.size > MAX_GROUPS) continue;
      for (const group of groups.values()) {
        add(group.length);
        for (const column of numeric) add(group.reduce((total, row) => total + (typeof row[column] === 'number' ? row[column] as number : 0), 0));
      }
    }
  };
  totals(rows);
  for (const label of labels) {
    const values = [...new Set(rows.map((row) => String(row[label] ?? '')))];
    if (values.length > MAX_LABEL_VALUES) continue;
    for (const excluded of values) totals(rows.filter((row) => String(row[label] ?? '') !== excluded));
  }
  return {
    exampleNumbersExplained: targets.filter((target) => produced.has(Math.round(target * 100) / 100)).length,
    exampleNumbersTested: targets.length,
  };
}

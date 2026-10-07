import type { TableArtifact } from './table.js';

/** Column name → the Korean header people read ("total_amount" → "총 금액"). */
export type ColumnLabels = Record<string, string>;

export const MAX_COLUMN_LABEL_CHARS = 30;
const MAX_REMEMBERED_LABELS = 2_000;
const HANGUL = /[가-힣]/u;
const LATIN = /[A-Za-z]/u;

/** A header someone who does not read code would not understand as is: Latin letters, no Hangul. */
export function needsColumnLabel(name: string): boolean {
  return LATIN.test(name) && !HANGUL.test(name);
}

export function validColumnLabel(label: unknown): label is string {
  return typeof label === 'string' && label.trim().length > 0
    && label.trim().length <= MAX_COLUMN_LABEL_CHARS && !/[\r\n|]/u.test(label);
}

/** The table with each known label on its column; data and column names stay as they were. */
export function labeledTable(table: TableArtifact, labels: ColumnLabels): TableArtifact {
  if (!table.columns.some((column) => !column.label && labels[column.name])) return table;
  return {
    ...table,
    columns: table.columns.map((column) => column.label || !labels[column.name] ? column : { ...column, label: labels[column.name] }),
  };
}

/** Labels learned so far plus new ones, newest kept when the set is full. */
export function mergeColumnLabels(known: ColumnLabels, learned: ColumnLabels): ColumnLabels {
  const merged: ColumnLabels = { ...known };
  for (const [name, label] of Object.entries(learned)) {
    if (!validColumnLabel(label)) continue;
    delete merged[name];
    merged[name] = label.trim();
  }
  const entries = Object.entries(merged);
  return entries.length > MAX_REMEMBERED_LABELS ? Object.fromEntries(entries.slice(-MAX_REMEMBERED_LABELS)) : merged;
}

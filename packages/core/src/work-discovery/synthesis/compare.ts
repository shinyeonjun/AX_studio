import type { ObservationValue } from '../observation/schema.js';
import type { ScalarValue } from '../../contracts/artifacts/table.js';
import { tableKeyColumns, tableRowKey } from '../observation/table-key.js';

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const DISPLAY_UNIT_SCALE: Record<string, number> = { '억': 100_000_000, '만': 10_000, '천': 1_000, '%': 1 };

/**
 * How finely the example shows a number: one unit in its last displayed place, in the value's own
 * scale ("12.3%" -> 0.1, "12%" -> 1, "1.2억" -> 10,000,000, "1,234" -> 1). A computed value
 * matches when it would be shown the same way, no looser: "12.3%" is not "12.7%".
 */
function displayStep(display: string | undefined): number | undefined {
  const match = display?.replace(/,/g, '').trim().match(/^[+-]?\d*(?:\.(\d+))?\s*(억|만|천|%)?$/u);
  if (!match || !/\d/u.test(match[0])) return undefined;
  return 10 ** -(match[1]?.length ?? 0) * (match[2] ? DISPLAY_UNIT_SCALE[match[2]]! : 1);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function compareObservationValue(
  expected: ObservationValue,
  actual: ScalarValue | unknown,
): number {
  if (expected.kind === 'number') {
    const expectedNumber = expected.value;
    const actualNumber = toNumber(actual);
    if (actualNumber == null) return 0;
    const step = displayStep(expected.display);
    if (step !== undefined) {
      const noise = 1e-9 * Math.max(1, Math.abs(expectedNumber));
      return Math.abs(expectedNumber - actualNumber) <= step / 2 + noise ? 1 : 0;
    }
    if (expected.unit === '%' || expected.display?.includes('%')) {
      const delta = Math.abs(expectedNumber - actualNumber);
      if (delta <= 0.05) return 1;
      if (delta <= 0.5) return 0.98;
      return delta / Math.max(Math.abs(expectedNumber), 1) <= 0.01 ? 0.95 : 0;
    }
    if (expected.unit === '억' || expected.display?.includes('억')) {
      if (expectedNumber === actualNumber) return 1;
      const scale = Math.max(Math.abs(expectedNumber), Math.abs(actualNumber), 1);
      return Math.abs(expectedNumber - actualNumber) / scale <= 0.01 ? 0.95 : 0;
    }
    if (Number.isInteger(expectedNumber)) {
      // Whole numbers must match exactly; only binary float noise (0.1 + 0.2) is forgiven.
      return Math.abs(expectedNumber - actualNumber) <= 1e-9 * Math.max(1, Math.abs(expectedNumber)) ? 1 : 0;
    }
    if (expectedNumber === actualNumber) return 1;
    const delta = Math.abs(expectedNumber - actualNumber);
    const scale = Math.max(Math.abs(expectedNumber), Math.abs(actualNumber), 1);
    return delta / scale <= 0.01 ? 0.95 : 0;
  }

  if (expected.kind === 'text') {
    return normalizeText(expected.value) === normalizeText(actual) ? 1 : 0;
  }

  if (expected.kind === 'date') {
    return normalizeText(expected.value) === normalizeText(actual) ? 1 : 0;
  }

  if (expected.kind === 'table') return compareTable(expected, actual);

  return String(expected) === String(actual) ? 1 : 0;
}

type ExpectedTable = Extract<ObservationValue, { kind: 'table' }>;
type TableCell = string | number | boolean | null;
interface ComparableTable {
  columns: string[];
  rows: Array<Record<string, TableCell>>;
}

function cellOf(row: Record<string, unknown> | undefined, column: string): TableCell {
  if (!row || !Object.hasOwn(row, column)) return null;
  const value = row[column];
  return value == null || typeof value === 'object' ? null : value as TableCell;
}

/** Accepts a TableArtifact (columns[].name, rows[].values) or an observed table value. */
function comparableTable(actual: unknown): ComparableTable | undefined {
  if (!actual || typeof actual !== 'object') return undefined;
  const record = actual as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(record.columns) || !Array.isArray(record.rows)) return undefined;
  const columns = record.columns.map((column) =>
    typeof column === 'string' ? column : String((column as { name?: unknown })?.name ?? ''));
  const rows = record.rows.map((row) => {
    const values = row && typeof row === 'object' && 'values' in (row as object)
      ? (row as { values?: Record<string, unknown> }).values
      : row as Record<string, unknown>;
    return Object.fromEntries(columns.map((column) => [column, cellOf(values, column)]));
  });
  return { columns, rows };
}

function compareCell(expected: TableCell, actual: TableCell): number {
  if (typeof expected === 'number') {
    return compareObservationValue({ kind: 'number', value: expected, display: String(expected) }, actual);
  }
  if (expected == null) return actual == null || normalizeText(actual) === '' ? 1 : 0;
  return normalizeText(expected) === normalizeText(actual) ? 1 : 0;
}

/**
 * Same headers, rows matched by the expected key columns (order-insensitive, one-to-one), every
 * cell compared like a scalar. Any structural mismatch scores 0; otherwise the weakest cell wins.
 */
function compareTable(expected: ExpectedTable, actual: unknown): number {
  const table = comparableTable(actual);
  if (!table) return 0;
  const expectedColumns = new Set(expected.columns);
  if (table.columns.length !== expectedColumns.size || !table.columns.every((column) => expectedColumns.has(column))) return 0;
  if (table.rows.length !== expected.rows.length) return 0;
  const keyColumns = tableKeyColumns(expected);
  if (!keyColumns) return 0;
  const actualByKey = new Map<string, Record<string, TableCell>>();
  for (const row of table.rows) {
    const key = tableRowKey(row, keyColumns);
    if (actualByKey.has(key)) return 0;
    actualByKey.set(key, row);
  }
  let score = 1;
  for (const expectedRow of expected.rows) {
    const actualRow = actualByKey.get(tableRowKey(expectedRow, keyColumns));
    if (!actualRow) return 0;
    for (const column of expected.columns) {
      if (keyColumns.includes(column)) continue;
      score = Math.min(score, compareCell(cellOf(expectedRow, column), cellOf(actualRow, column)));
      if (score === 0) return 0;
    }
  }
  return score;
}

export function replayPassThreshold(match: number): boolean {
  return match >= 0.95;
}

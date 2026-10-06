import type { ScalarValue, TableArtifact } from '../../../contracts/artifacts/table.js';
import type { TransformEvaluation } from './contracts.js';

/** Own-property cell read: user-chosen column names never reach Object.prototype. */
export function ownCell<T>(values: Readonly<Record<string, T>> | undefined, column: string): T | null {
  return values && Object.hasOwn(values, column) ? values[column] ?? null : null;
}

export function rowValue(row: TableArtifact['rows'][number], column: string): ScalarValue {
  return ownCell(row.values, column);
}

export function compareScalar(left: ScalarValue, right: ScalarValue): boolean {
  if (left == null || right == null) return left === right;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  return String(left) === String(right);
}

/**
 * A cell as a number, the way people write money and amounts: thousands separators, a currency
 * sign or 원, a percent sign (50% -> 50, as shown) and accounting negatives ((1,000) -> -1000).
 * Hex and other non-decimal forms are not numbers.
 */
export function toNumber(value: ScalarValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/,/g, '').replace(/^[₩$€£¥]\s*/u, '').replace(/\s*(원|%)$/u, '').trim();
  let negative = false;
  if (/^\(.*\)$/u.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/iu.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function requireTable(input: TransformEvaluation, errorCode: string): TableArtifact {
  if (!input || typeof input !== 'object' || !('rows' in input)) {
    throw new Error(errorCode);
  }
  return input as TableArtifact;
}

export function requireCompleteTable(input: TransformEvaluation, errorCode: string): TableArtifact {
  const table = requireTable(input, errorCode);
  const status = table.completeness?.status ?? (table.truncated ? 'partial' : 'complete');
  if (table.truncated || status !== 'complete') throw new Error('incomplete_table_input');
  // A DB page says whether the page is whole; coverage says whether the source is. A later page
  // (offset > 0) is a whole page of a partial source: totals over it are not totals.
  if (table.coverage?.source === 'partial') throw new Error('incomplete_table_input');
  return table;
}

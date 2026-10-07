import type { ScalarValue, TableArtifact } from '../../../contracts/artifacts/table.js';
import type { TransformEvaluation } from './contracts.js';
import { parseWrittenNumber } from '../../../contracts/number-text.js';

/** Own-property cell read: user-chosen column names never reach Object.prototype. */
export function ownCell<T>(values: Readonly<Record<string, T>> | undefined, column: string): T | null {
  return values && Object.hasOwn(values, column) ? values[column] ?? null : null;
}

export function rowValue(row: TableArtifact['rows'][number], column: string): ScalarValue {
  return ownCell(row.values, column);
}

/**
 * Equality as people mean it in a cell: "서울 " is 서울, and a Mac file's decomposed 한글 is the
 * same word; group keys already read cells this way.
 */
export function compareScalar(left: ScalarValue, right: ScalarValue): boolean {
  if (left == null || right == null) return left === right;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  return String(left).normalize('NFC').trim() === String(right).normalize('NFC').trim();
}

/** A cell as a number, the way people write money and amounts (see parseWrittenNumber). */
export function toNumber(value: ScalarValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'string' ? parseWrittenNumber(value) : null;
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

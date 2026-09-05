import type { ScalarValue, TableArtifact } from '../../../contracts/artifacts/table.js';
import type { TransformEvaluation } from './contracts.js';

export function rowValue(row: TableArtifact['rows'][number], column: string): ScalarValue {
  return row.values[column] ?? null;
}

export function compareScalar(left: ScalarValue, right: ScalarValue): boolean {
  if (left == null || right == null) return left === right;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  return String(left) === String(right);
}

export function toNumber(value: ScalarValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  return table;
}

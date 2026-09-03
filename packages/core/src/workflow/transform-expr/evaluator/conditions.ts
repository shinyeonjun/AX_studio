import type { ConditionExpr } from '../../../runtime/condition-expr.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import { compareScalar, rowValue } from './helpers.js';

export function evaluateConditionOnRow(
  expr: ConditionExpr,
  row: TableArtifact['rows'][number],
): boolean {
  switch (expr.op) {
    case 'eq':
      return compareScalar(
        'lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref),
        'lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref),
      );
    case 'neq':
      return !compareScalar(
        'lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref),
        'lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref),
      );
    case 'contains': {
      const left = 'lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref);
      const right = 'lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref);
      return String(left ?? '').includes(String(right ?? ''));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = Number('lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref));
      const right = Number('lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref));
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      if (expr.op === 'gt') return left > right;
      if (expr.op === 'gte') return left >= right;
      if (expr.op === 'lt') return left < right;
      return left <= right;
    }
    case 'and':
      return expr.args.every((arg) => evaluateConditionOnRow(arg, row));
    case 'or':
      return expr.args.some((arg) => evaluateConditionOnRow(arg, row));
    case 'not':
      return !evaluateConditionOnRow(expr.arg, row);
    default:
      return false;
  }
}

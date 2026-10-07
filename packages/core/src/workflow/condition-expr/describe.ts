import type { ConditionExpr, ConditionValue } from './schema.js';

const COMPARISON_SYMBOLS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: '포함',
};

/** A column as people read it (its Korean header), given its name. */
export type ColumnNamer = (name: string) => string;
const asNamed: ColumnNamer = (name) => name;

function describeValue(value: ConditionValue, columnName: ColumnNamer): string {
  return 'ref' in value ? columnName(value.ref) : String(value.lit);
}

/** Short, symbol-based description of a row condition ("재고 < 10 그리고 상태 ≠ 취소"). */
export function describeCondition(condition: ConditionExpr, columnName: ColumnNamer = asNamed): string {
  switch (condition.op) {
    case 'and':
      return condition.args.map((arg) => describeCondition(arg, columnName)).join(' 그리고 ');
    case 'or':
      return condition.args.map((arg) => describeCondition(arg, columnName)).join(' 또는 ');
    case 'not':
      return `아님(${describeCondition(condition.arg, columnName)})`;
    default:
      return `${describeValue(condition.left, columnName)} ${COMPARISON_SYMBOLS[condition.op] ?? condition.op} ${describeValue(condition.right, columnName)}`;
  }
}

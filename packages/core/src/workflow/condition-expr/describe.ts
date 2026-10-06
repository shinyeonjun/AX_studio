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

function describeValue(value: ConditionValue): string {
  return 'ref' in value ? value.ref : String(value.lit);
}

/** Short, symbol-based description of a row condition ("stock < 10 그리고 상태 ≠ 취소"). */
export function describeCondition(condition: ConditionExpr): string {
  switch (condition.op) {
    case 'and':
      return condition.args.map(describeCondition).join(' 그리고 ');
    case 'or':
      return condition.args.map(describeCondition).join(' 또는 ');
    case 'not':
      return `아님(${describeCondition(condition.arg)})`;
    default:
      return `${describeValue(condition.left)} ${COMPARISON_SYMBOLS[condition.op] ?? condition.op} ${describeValue(condition.right)}`;
  }
}

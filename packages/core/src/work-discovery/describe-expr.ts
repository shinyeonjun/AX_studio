import type { ConditionExpr, ConditionValue } from '../workflow/condition-expr/schema.js';
import type { TransformExpr } from '../workflow/transform-expr/dsl.js';

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

/** Row conditions applied below an expression's input chain, outermost last. */
export function rowConditions(expr: TransformExpr): ConditionExpr[] {
  if (expr.op === 'source' || expr.op === 'ratio') return [];
  const inner = rowConditions(expr.input);
  return expr.op === 'filter' ? [...inner, expr.where] : inner;
}

/** Stable identity of an expression's row filter, for telling apart rules that keep different rows. */
export function filterSignature(expr: TransformExpr): string {
  if (expr.op === 'ratio') return `${filterSignature(expr.numerator)}/${filterSignature(expr.denominator)}`;
  const conditions = rowConditions(expr);
  return conditions.length === 0 ? '' : JSON.stringify(conditions);
}

function aggregateLabel(spec: { fn: string; column?: string; round?: number }): string {
  const rounding = spec.round !== undefined ? ` 반올림(소수 ${spec.round}자리)` : '';
  return spec.fn === 'count' && !spec.column
    ? `COUNT${rounding}`
    : `${spec.fn.toUpperCase()}(${spec.column ?? 'rows'})${rounding}`;
}

function withConditions(label: string, expr: TransformExpr): string {
  const conditions = rowConditions(expr);
  return conditions.length === 0 ? label : `${label} · 조건: ${conditions.map(describeCondition).join(', ')}`;
}

/** Short Korean description of a learned mapping, shown in the review card and questions. */
export function describeMapping(expr: TransformExpr): string {
  switch (expr.op) {
    case 'aggregate':
      return withConditions(aggregateLabel(expr), expr.input);
    case 'group': {
      const measures = expr.aggregates.map((aggregate) => `${aggregate.as}=${aggregateLabel(aggregate)}`).join(', ');
      const label = withConditions(`${expr.by}별 묶음: ${measures}`, expr.input);
      return expr.totalRow ? `${label} · 합계 줄 포함` : label;
    }
    case 'ratio': {
      const rounding = expr.round !== undefined ? ` 반올림(소수 ${expr.round}자리)` : '';
      return withConditions(`RATIO(%)${rounding}`, expr.numerator);
    }
    case 'column':
      return withConditions(`COLUMN(${expr.name})`, expr.input);
    default:
      return expr.op;
  }
}

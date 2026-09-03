import type { ConditionExpr, ConditionValue } from './schema.js';

function resolveRef(ref: string, variables: Record<string, unknown>, stepResults: Record<string, unknown>): unknown {
  const path = ref.startsWith('trigger.') ? ref.slice('trigger.'.length) : ref;
  const [root, ...rest] = path.split('.');
  let current: unknown = Object.hasOwn(stepResults, root) ? stepResults[root] : variables[root];
  for (const key of rest) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveValue(
  value: ConditionValue,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): unknown {
  if ('lit' in value) return value.lit;
  return resolveRef(value.ref, variables, stepResults);
}

function compareValues(left: unknown, right: unknown): number | null {
  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);
  return leftNum == null || rightNum == null ? null : leftNum - rightNum;
}

export function evaluateCondition(
  expr: ConditionExpr,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): boolean {
  switch (expr.op) {
    case 'eq':
      return resolveValue(expr.left, variables, stepResults) === resolveValue(expr.right, variables, stepResults);
    case 'neq':
      return resolveValue(expr.left, variables, stepResults) !== resolveValue(expr.right, variables, stepResults);
    case 'contains': {
      const left = resolveValue(expr.left, variables, stepResults);
      const right = resolveValue(expr.right, variables, stepResults);
      if (left == null || right == null) return false;
      return String(left).includes(String(right));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareValues(
        resolveValue(expr.left, variables, stepResults),
        resolveValue(expr.right, variables, stepResults),
      );
      if (cmp == null) return false;
      if (expr.op === 'gt') return cmp > 0;
      if (expr.op === 'gte') return cmp >= 0;
      if (expr.op === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    case 'and':
      return expr.args.every((arg) => evaluateCondition(arg, variables, stepResults));
    case 'or':
      return expr.args.some((arg) => evaluateCondition(arg, variables, stepResults));
    case 'not':
      return !evaluateCondition(expr.arg, variables, stepResults);
    default:
      return false;
  }
}

import type { ConditionExpr, ConditionValue } from './schema.js';

function resolveRef(
  ref: string,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
  outputs?: Record<string, Record<string, unknown>>,
): unknown {
  const path = ref.startsWith('trigger.') ? ref.slice('trigger.'.length) : ref;
  const [root, ...rest] = path.split('.');
  const [outputPort, ...nestedPath] = rest;
  const typedOutput = outputPort && outputs?.[root]?.[outputPort];
  let current: unknown;
  if (typedOutput !== undefined) {
    current = typedOutput;
    for (const key of nestedPath) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  current = Object.hasOwn(stepResults, root) ? stepResults[root] : variables[root];
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
  outputs?: Record<string, Record<string, unknown>>,
): unknown {
  if ('lit' in value) return value.lit;
  return resolveRef(value.ref, variables, stepResults, outputs);
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
  outputs?: Record<string, Record<string, unknown>>,
): boolean {
  switch (expr.op) {
    case 'eq':
      return resolveValue(expr.left, variables, stepResults, outputs) === resolveValue(expr.right, variables, stepResults, outputs);
    case 'neq':
      return resolveValue(expr.left, variables, stepResults, outputs) !== resolveValue(expr.right, variables, stepResults, outputs);
    case 'contains': {
      const left = resolveValue(expr.left, variables, stepResults, outputs);
      const right = resolveValue(expr.right, variables, stepResults, outputs);
      if (left == null || right == null) return false;
      return String(left).includes(String(right));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareValues(
        resolveValue(expr.left, variables, stepResults, outputs),
        resolveValue(expr.right, variables, stepResults, outputs),
      );
      if (cmp == null) return false;
      if (expr.op === 'gt') return cmp > 0;
      if (expr.op === 'gte') return cmp >= 0;
      if (expr.op === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    case 'and':
      return expr.args.every((arg) => evaluateCondition(arg, variables, stepResults, outputs));
    case 'or':
      return expr.args.some((arg) => evaluateCondition(arg, variables, stepResults, outputs));
    case 'not':
      return !evaluateCondition(expr.arg, variables, stepResults, outputs);
    default:
      return false;
  }
}

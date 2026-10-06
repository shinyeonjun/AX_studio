import type { ConditionExpr, ConditionValue } from '../../workflow/condition-expr/schema.js';
import { readOwnPath, readTriggerPath } from '../../workflow/value-path.js';

function resolveRef(
  ref: string,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
  outputs?: Record<string, Record<string, unknown>>,
): unknown {
  // Match parameter templates: `trigger.x` reads trigger variables only.
  if (ref.startsWith('trigger.')) return readTriggerPath(variables, ref.slice('trigger.'.length));
  const [root, ...rest] = ref.split('.');
  const [outputPort, ...nestedPath] = rest;
  const stepOutputs = outputs && Object.hasOwn(outputs, root) ? outputs[root] : undefined;
  if (outputPort && stepOutputs && Object.hasOwn(stepOutputs, outputPort) && stepOutputs[outputPort] !== undefined) {
    return readOwnPath(stepOutputs[outputPort], nestedPath);
  }
  const base = Object.hasOwn(stepResults, root)
    ? stepResults[root]
    : Object.hasOwn(variables, root) ? variables[root] : undefined;
  return readOwnPath(base, rest);
}

function resolveValue(
  value: ConditionValue,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
  outputs?: Record<string, Record<string, unknown>>,
): unknown {
  if ('lit' in value) return value.lit;
  const resolved = resolveRef(value.ref, variables, stepResults, outputs);
  // A missing reference is not a comparable value: `neq` must not become true
  // merely because an upstream field was absent. Fail the condition loudly.
  if (resolved === undefined) {
    throw Object.assign(new Error(`조건식 참조를 해석할 수 없습니다: ${value.ref}`), {
      code: 'condition_ref_missing',
      reference: value.ref,
    });
  }
  return resolved;
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

/**
 * Evaluate a declarative condition. Throws `condition_ref_missing` when a
 * compared reference does not resolve; callers that must not throw (trigger
 * filters) treat that as a non-match.
 */
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
      // An empty search term is contained in everything: a keyword that came out blank would make
      // a filter or a trigger match every message. Nothing to look for matches nothing.
      if (left == null || right == null || String(right).trim() === '') return false;
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

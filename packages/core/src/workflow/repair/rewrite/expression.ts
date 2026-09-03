import type { ConditionExpr, ConditionValue } from '../../../runtime/condition-expr.js';
import type { RepairCandidateOperation } from '../contract.js';
import type { TransformExpr } from '../../transform-expr/dsl.js';

function sourceIdsInExpr(expr: TransformExpr): Set<string> {
  if (expr.op === 'source') return new Set([expr.sourceId]);
  if (expr.op === 'ratio') {
    return new Set([
      ...sourceIdsInExpr(expr.numerator),
      ...sourceIdsInExpr(expr.denominator),
    ]);
  }
  return sourceIdsInExpr(expr.input);
}

function renameConditionValue(value: ConditionValue, from: string, to: string): ConditionValue {
  return 'ref' in value && value.ref === from ? { ...value, ref: to } : value;
}

function renameCondition(condition: ConditionExpr, from: string, to: string): ConditionExpr {
  switch (condition.op) {
    case 'and':
    case 'or':
      return { ...condition, args: condition.args.map((entry) => renameCondition(entry, from, to)) };
    case 'not':
      return { ...condition, arg: renameCondition(condition.arg, from, to) };
    default:
      return {
        ...condition,
        left: renameConditionValue(condition.left, from, to),
        right: renameConditionValue(condition.right, from, to),
      };
  }
}

export function renameExpr(
  expr: TransformExpr,
  candidate: RepairCandidateOperation,
): { expr: TransformExpr; changed: boolean } {
  const inScope = sourceIdsInExpr(expr).has(candidate.sourceId);
  const rename = (value: string): { value: string; changed: boolean } =>
    inScope && value === candidate.from
      ? { value: candidate.to, changed: true }
      : { value, changed: false };

  switch (expr.op) {
    case 'source':
      return { expr, changed: false };
    case 'column': {
      const input = renameExpr(expr.input, candidate);
      const name = rename(expr.name);
      return { expr: { ...expr, input: input.expr, name: name.value }, changed: input.changed || name.changed };
    }
    case 'filter': {
      const input = renameExpr(expr.input, candidate);
      const where = inScope ? renameCondition(expr.where, candidate.from, candidate.to) : expr.where;
      return {
        expr: { ...expr, input: input.expr, where },
        changed: input.changed || (inScope && JSON.stringify(where) !== JSON.stringify(expr.where)),
      };
    }
    case 'aggregate': {
      const input = renameExpr(expr.input, candidate);
      const column = expr.column === undefined ? undefined : rename(expr.column).value;
      return {
        expr: { ...expr, input: input.expr, ...(column === undefined ? {} : { column }) },
        changed: input.changed || (inScope && expr.column === candidate.from),
      };
    }
    case 'ratio': {
      const numerator = renameExpr(expr.numerator, candidate);
      const denominator = renameExpr(expr.denominator, candidate);
      return {
        expr: { ...expr, numerator: numerator.expr, denominator: denominator.expr },
        changed: numerator.changed || denominator.changed,
      };
    }
    case 'lookup': {
      const input = renameExpr(expr.input, candidate);
      const keyColumn = rename(expr.keyColumn);
      const valueColumn = rename(expr.valueColumn);
      return {
        expr: { ...expr, input: input.expr, keyColumn: keyColumn.value, valueColumn: valueColumn.value },
        changed: input.changed || keyColumn.changed || valueColumn.changed,
      };
    }
    case 'select': {
      const input = renameExpr(expr.input, candidate);
      const columns = expr.columns.map((column) => rename(column).value);
      return { expr: { ...expr, input: input.expr, columns }, changed: input.changed || columns.some((column, index) => column !== expr.columns[index]) };
    }
    case 'sort': {
      const input = renameExpr(expr.input, candidate);
      const by = expr.by.map((entry) => ({ ...entry, column: rename(entry.column).value }));
      return { expr: { ...expr, input: input.expr, by }, changed: input.changed || by.some((entry, index) => entry.column !== expr.by[index]?.column) };
    }
    case 'limit': {
      const input = renameExpr(expr.input, candidate);
      return { expr: { ...expr, input: input.expr }, changed: input.changed };
    }
  }
}

import type { ReportAggregateExpression, ReportPrimitive } from './schema.js';
import {
  asPrimitive,
  evaluateArithmetic,
  evaluatePredicate,
  evaluateValue,
  numericValue,
  type ReportRow,
} from './value.js';

function filteredRows(expression: Exclude<ReportAggregateExpression, { kind: 'arithmetic' }>, rows: ReportRow[]): ReportRow[] {
  return expression.where ? rows.filter((row) => evaluatePredicate(expression.where!, row)) : rows;
}

function stableKey(value: unknown): string {
  const primitive = asPrimitive(value, 'distinct_key');
  return `${typeof primitive}:${String(primitive)}`;
}

function samePrimitive(left: ReportPrimitive, right: ReportPrimitive): boolean {
  return typeof left === typeof right && left === right;
}

export function evaluateAggregate(expression: ReportAggregateExpression, rows: ReportRow[]): ReportPrimitive {
  if (expression.kind === 'arithmetic') {
    return evaluateArithmetic(
      expression.operation,
      numericValue(evaluateAggregate(expression.left, rows), expression.operation + '.aggregate.left'),
      numericValue(evaluateAggregate(expression.right, rows), expression.operation + '.aggregate.right'),
    );
  }

  const selected = filteredRows(expression, rows);
  switch (expression.kind) {
    case 'count':
      return selected.length;
    case 'count_distinct':
      return new Set(selected.map((row) => stableKey(evaluateValue(expression.value, row)))).size;
    case 'sum':
      return selected.reduce((total, row) => total + numericValue(evaluateValue(expression.value, row), 'sum'), 0);
    case 'average':
      if (selected.length === 0) return 0;
      return selected.reduce((total, row) => total + numericValue(evaluateValue(expression.value, row), 'average'), 0) / selected.length;
    case 'min':
    case 'max': {
      if (selected.length === 0) return null;
      const values = selected.map((row) => numericValue(evaluateValue(expression.value, row), expression.kind));
      return expression.kind === 'min' ? Math.min(...values) : Math.max(...values);
    }
    case 'sum_distinct': {
      const values = new Map<string, number>();
      for (const row of selected) {
        const key = stableKey(evaluateValue(expression.distinctBy, row));
        const value = numericValue(evaluateValue(expression.value, row), 'sum_distinct');
        const previous = values.get(key);
        if (previous !== undefined && previous !== value) {
          throw new Error(`report_distinct_value_conflict:${key}`);
        }
        values.set(key, value);
      }
      return [...values.values()].reduce((total, value) => total + value, 0);
    }
    case 'first': {
      if (selected.length === 0) return null;
      const first = asPrimitive(evaluateValue(expression.value, selected[0]!), 'first');
      if (expression.requireConsistent) {
        for (const row of selected.slice(1)) {
          const value = asPrimitive(evaluateValue(expression.value, row), 'first');
          if (!samePrimitive(first, value)) throw new Error('report_first_value_inconsistent');
        }
      }
      return first;
    }
  }
}

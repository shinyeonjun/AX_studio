import type { ReportAggregateExpression, ReportPrimitive } from './schema.js';
import {
  asPrimitive,
  evaluateArithmetic,
  evaluatePredicate,
  evaluateValue,
  isBlankCell,
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

/** The numbers an aggregate is over: blank cells are skipped, text that is not a number fails. */
function numbersOf(value: Parameters<typeof evaluateValue>[0], rows: ReportRow[], context: string): number[] {
  const numbers: number[] = [];
  for (const row of rows) {
    const cell = evaluateValue(value, row);
    if (!isBlankCell(cell)) numbers.push(numericValue(cell, context));
  }
  return numbers;
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
      return numbersOf(expression.value, selected, 'sum').reduce((total, value) => total + value, 0);
    case 'average': {
      const values = numbersOf(expression.value, selected, 'average');
      if (values.length === 0) return null;
      return values.reduce((total, value) => total + value, 0) / values.length;
    }
    case 'min':
    case 'max': {
      const values = numbersOf(expression.value, selected, expression.kind);
      if (values.length === 0) return null;
      // A loop, not Math.min(...values): spreading a large array overflows the call stack.
      let result = values[0]!;
      for (const value of values) {
        if (expression.kind === 'min' ? value < result : value > result) result = value;
      }
      return result;
    }
    case 'sum_distinct': {
      const values = new Map<string, number>();
      for (const row of selected) {
        const cell = evaluateValue(expression.value, row);
        if (isBlankCell(cell)) continue;
        const key = stableKey(evaluateValue(expression.distinctBy, row));
        const value = numericValue(cell, 'sum_distinct');
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

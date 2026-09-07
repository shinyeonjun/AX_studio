import type {
  ReportOutputPredicate,
  ReportOutputValueExpression,
  ReportPredicate,
  ReportPrimitive,
  ReportValueExpression,
} from './schema.js';

export type ReportRow = Record<string, unknown>;

export function valueAtPath(row: ReportRow, path: string): unknown {
  let current: unknown = row;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function numericValue(value: unknown, context = 'value'): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/,/g, '');
    if (normalized && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  throw new Error(`report_number_required:${context}`);
}

function arithmetic(operation: 'add' | 'subtract' | 'multiply' | 'divide', left: number, right: number): number {
  if (operation === 'divide' && right === 0) throw new Error('report_division_by_zero');
  switch (operation) {
    case 'add': return left + right;
    case 'subtract': return left - right;
    case 'multiply': return left * right;
    case 'divide': return left / right;
  }
}

export function evaluateValue(expression: ReportValueExpression, row: ReportRow): unknown {
  switch (expression.kind) {
    case 'field':
      return valueAtPath(row, expression.path);
    case 'literal':
      return expression.value;
    case 'arithmetic':
      return arithmetic(
        expression.operation,
        numericValue(evaluateValue(expression.left, row), expression.operation + '.left'),
        numericValue(evaluateValue(expression.right, row), expression.operation + '.right'),
      );
    case 'coalesce':
      for (const item of expression.values) {
        const value = evaluateValue(item, row);
        if (value !== null && value !== undefined && value !== '') return value;
      }
      return null;
    case 'concat':
      return expression.values
        .map((item) => evaluateValue(item, row))
        .filter((value) => value !== null && value !== undefined)
        .map(String)
        .join(expression.separator ?? '');
  }
}

export function comparable(value: unknown): string | number | boolean | null | undefined {
  if (value == null || typeof value === 'boolean') return value;
  try {
    return numericValue(value);
  } catch {
    return String(value);
  }
}

export function compareValues(operation: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte', left: unknown, right: unknown): boolean {
  const a = comparable(left);
  const b = comparable(right);
  switch (operation) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'gt': return a != null && b != null && a > b;
    case 'gte': return a != null && b != null && a >= b;
    case 'lt': return a != null && b != null && a < b;
    case 'lte': return a != null && b != null && a <= b;
  }
}

export function evaluatePredicate(predicate: ReportPredicate, row: ReportRow): boolean {
  switch (predicate.kind) {
    case 'compare':
      return compareValues(
        predicate.operation,
        evaluateValue(predicate.left, row),
        evaluateValue(predicate.right, row),
      );
    case 'in': {
      const value = evaluateValue(predicate.value, row);
      return predicate.values.some((candidate) => compareValues('eq', value, evaluateValue(candidate, row)));
    }
    case 'and': return predicate.items.every((item) => evaluatePredicate(item, row));
    case 'or': return predicate.items.some((item) => evaluatePredicate(item, row));
    case 'not': return !evaluatePredicate(predicate.item, row);
    case 'is_null': {
      const isNull = evaluateValue(predicate.value, row) == null;
      return predicate.negate ? !isNull : isNull;
    }
  }
}

export function evaluateOutputValue(expression: ReportOutputValueExpression, row: Record<string, ReportPrimitive>): unknown {
  switch (expression.kind) {
    case 'column':
      return row[expression.columnId];
    case 'literal':
      return expression.value;
    case 'arithmetic':
      return arithmetic(
        expression.operation,
        numericValue(evaluateOutputValue(expression.left, row), expression.operation + '.output.left'),
        numericValue(evaluateOutputValue(expression.right, row), expression.operation + '.output.right'),
      );
    case 'coalesce':
      for (const item of expression.values) {
        const value = evaluateOutputValue(item, row);
        if (value !== null && value !== undefined && value !== '') return value;
      }
      return null;
    case 'concat':
      return expression.values
        .map((item) => evaluateOutputValue(item, row))
        .filter((value) => value !== null && value !== undefined)
        .map(String)
        .join(expression.separator ?? '');
    case 'case':
      for (const branch of expression.branches) {
        if (evaluateOutputPredicate(branch.when, row)) return evaluateOutputValue(branch.value, row);
      }
      return evaluateOutputValue(expression.fallback, row);
  }
}

export function evaluateOutputPredicate(predicate: ReportOutputPredicate, row: Record<string, ReportPrimitive>): boolean {
  switch (predicate.kind) {
    case 'compare':
      return compareValues(
        predicate.operation,
        evaluateOutputValue(predicate.left, row),
        evaluateOutputValue(predicate.right, row),
      );
    case 'in': {
      const value = evaluateOutputValue(predicate.value, row);
      return predicate.values.some((candidate) => compareValues('eq', value, evaluateOutputValue(candidate, row)));
    }
    case 'and': return predicate.items.every((item) => evaluateOutputPredicate(item, row));
    case 'or': return predicate.items.some((item) => evaluateOutputPredicate(item, row));
    case 'not': return !evaluateOutputPredicate(predicate.item, row);
    case 'is_null': {
      const isNull = evaluateOutputValue(predicate.value, row) == null;
      return predicate.negate ? !isNull : isNull;
    }
  }
}

export function asPrimitive(value: unknown, context: string): ReportPrimitive {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === undefined) return null;
  throw new Error(`report_primitive_required:${context}`);
}

export { arithmetic as evaluateArithmetic };

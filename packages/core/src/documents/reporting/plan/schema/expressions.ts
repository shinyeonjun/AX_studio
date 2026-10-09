import { z } from 'zod';
import type {
  ReportValueExpression,
  ReportPredicate,
  ReportAggregateExpression,
  ReportScalarExpression,
  ReportAggregateColumnValue,
  ReportOutputValueExpression,
  ReportDerivedExpression,
  ReportDerivedPredicate,
  ReportOutputPredicate,
} from './types.js';

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ReportValueExpressionSchema: z.ZodType<ReportValueExpression> = z.lazy(() => z.union([
  z.object({ kind: z.literal('field'), path: z.string().min(1) }),
  z.object({ kind: z.literal('literal'), value: PrimitiveSchema }),
  z.object({
    kind: z.literal('arithmetic'),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: ReportValueExpressionSchema,
    right: ReportValueExpressionSchema,
  }),
  z.object({ kind: z.literal('coalesce'), values: z.array(ReportValueExpressionSchema).min(1).max(20) }),
  z.object({
    kind: z.literal('concat'),
    values: z.array(ReportValueExpressionSchema).min(1).max(20),
    separator: z.string().max(20).optional(),
  }),
]));

function normalizeAggregateOperator(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!['add', 'subtract', 'multiply', 'divide'].includes(String(record.kind))) return value;
  if (!Object.hasOwn(record, 'left') || !Object.hasOwn(record, 'right')) return value;
  return { ...record, kind: 'arithmetic', operation: record.kind };
}

export const ReportPredicateSchema: z.ZodType<ReportPredicate> = z.lazy(() => z.union([
  z.object({
    kind: z.literal('compare'),
    operation: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    left: ReportValueExpressionSchema,
    right: ReportValueExpressionSchema,
  }),
  z.object({
    kind: z.literal('in'),
    value: ReportValueExpressionSchema,
    values: z.array(ReportValueExpressionSchema).min(1).max(100),
  }),
  z.object({ kind: z.enum(['and', 'or']), items: z.array(ReportPredicateSchema).min(1).max(50) }),
  z.object({ kind: z.literal('not'), item: ReportPredicateSchema }),
  z.object({ kind: z.literal('is_null'), value: ReportValueExpressionSchema, negate: z.boolean().optional() }),
]));

const ReportAggregateExpressionSchema = z.lazy(() => z.preprocess(
  normalizeAggregateOperator,
  z.union([
  z.object({ kind: z.literal('count'), where: ReportPredicateSchema.optional() }),
  z.object({ kind: z.literal('count_distinct'), value: ReportValueExpressionSchema, where: ReportPredicateSchema.optional() }),
  z.object({ kind: z.enum(['sum', 'average', 'min', 'max']), value: ReportValueExpressionSchema, where: ReportPredicateSchema.optional() }),
  z.object({
    kind: z.literal('sum_distinct'),
    value: ReportValueExpressionSchema,
    distinctBy: ReportValueExpressionSchema,
    where: ReportPredicateSchema.optional(),
  }),
  z.object({
    kind: z.literal('first'),
    value: ReportValueExpressionSchema,
    requireConsistent: z.boolean().optional(),
    where: ReportPredicateSchema.optional(),
  }),
  z.object({
    kind: z.literal('arithmetic'),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: ReportAggregateExpressionSchema,
    right: ReportAggregateExpressionSchema,
  }),
  ]),
)) as unknown as z.ZodType<ReportAggregateExpression>;

export const ReportScalarExpressionSchema: z.ZodType<ReportScalarExpression> = z.lazy(() => z.union([
  ReportAggregateExpressionSchema,
  ReportValueExpressionSchema,
  z.object({
    kind: z.literal('arithmetic'),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: ReportScalarExpressionSchema,
    right: ReportScalarExpressionSchema,
  }),
  z.object({ kind: z.literal('coalesce'), values: z.array(ReportScalarExpressionSchema).min(1).max(20) }),
  z.object({
    kind: z.literal('concat'),
    values: z.array(ReportScalarExpressionSchema).min(1).max(20),
    separator: z.string().max(20).optional(),
  }),
])) as z.ZodType<ReportScalarExpression>;

const OutputValueSchema: z.ZodType<ReportOutputValueExpression> = z.lazy(() => z.union([
  z.object({ kind: z.literal('column'), columnId: z.string().min(1) }),
  z.object({ kind: z.literal('literal'), value: PrimitiveSchema }),
  z.object({
    kind: z.literal('arithmetic'),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: OutputValueSchema,
    right: OutputValueSchema,
  }),
  z.object({ kind: z.literal('coalesce'), values: z.array(OutputValueSchema).min(1).max(20) }),
  z.object({
    kind: z.literal('concat'),
    values: z.array(OutputValueSchema).min(1).max(20),
    separator: z.string().max(20).optional(),
  }),
  z.object({
    kind: z.literal('case'),
    branches: z.array(z.object({
      when: OutputPredicateSchema,
      value: OutputValueSchema,
    })).min(1).max(20),
    fallback: OutputValueSchema,
  }),
]));
export const OutputPredicateSchema: z.ZodType<ReportOutputPredicate> = z.lazy(() => z.union([
  z.object({
    kind: z.literal('compare'),
    operation: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    left: OutputValueSchema,
    right: OutputValueSchema,
  }),
  z.object({ kind: z.literal('in'), value: OutputValueSchema, values: z.array(OutputValueSchema).min(1).max(100) }),
  z.object({ kind: z.enum(['and', 'or']), items: z.array(OutputPredicateSchema).min(1).max(50) }),
  z.object({ kind: z.literal('not'), item: OutputPredicateSchema }),
  z.object({ kind: z.literal('is_null'), value: OutputValueSchema, negate: z.boolean().optional() }),
]));

const ReportDerivedExpressionSchema: z.ZodType<ReportDerivedExpression> = z.lazy(() => z.union([
  OutputValueSchema,
  ReportAggregateExpressionSchema,
  z.object({ kind: z.literal('scalar'), scalarId: z.string().min(1) }),
  z.object({
    kind: z.literal('arithmetic'),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: ReportDerivedExpressionSchema,
    right: ReportDerivedExpressionSchema,
  }),
  z.object({ kind: z.literal('coalesce'), values: z.array(ReportDerivedExpressionSchema).min(1).max(20) }),
  z.object({
    kind: z.literal('concat'),
    values: z.array(ReportDerivedExpressionSchema).min(1).max(20),
    separator: z.string().max(20).optional(),
  }),
  z.object({
    kind: z.literal('case'),
    branches: z.array(z.object({
      when: z.lazy(() => ReportDerivedPredicateSchema),
      value: ReportDerivedExpressionSchema,
    })).min(1).max(20),
    fallback: ReportDerivedExpressionSchema,
  }),
])) as z.ZodType<ReportDerivedExpression>;

const ReportDerivedPredicateSchema: z.ZodType<ReportDerivedPredicate> = z.lazy(() => z.union([
  z.object({
    kind: z.literal('compare'),
    operation: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    left: ReportDerivedExpressionSchema,
    right: ReportDerivedExpressionSchema,
  }),
  z.object({
    kind: z.literal('in'),
    value: ReportDerivedExpressionSchema,
    values: z.array(ReportDerivedExpressionSchema).min(1).max(100),
  }),
  z.object({ kind: z.enum(['and', 'or']), items: z.array(ReportDerivedPredicateSchema).min(1).max(50) }),
  z.object({ kind: z.literal('not'), item: ReportDerivedPredicateSchema }),
  z.object({ kind: z.literal('is_null'), value: ReportDerivedExpressionSchema, negate: z.boolean().optional() }),
]));

/** Models often omit the wrapper around a grouped table cell and return the
 * aggregate/output expression directly. Accept that surface form at the
 * planner boundary, then normalize it to the single runtime representation
 * used by execution and reusability checks. */
function isAggregateColumnExpression(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'count':
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'sum_distinct':
    case 'first':
      return true;
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return isAggregateColumnExpression(record.left) && isAggregateColumnExpression(record.right);
    default:
      return false;
  }
}

function isValueExpression(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'field':
      return typeof record.path === 'string';
    case 'literal':
      return Object.hasOwn(record, 'value');
    case 'arithmetic':
      return isValueExpression(record.left) && isValueExpression(record.right);
    case 'coalesce':
    case 'concat':
      return Array.isArray(record.values) && record.values.length > 0
        && record.values.every(isValueExpression);
    default:
      return false;
  }
}

function containsValueField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsValueField);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'field') return true;
  return Object.values(record).some(containsValueField);
}

function normalizeAggregateColumnValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.kind === 'group_key' || record.kind === 'row_number') return value;
  if (record.kind === 'aggregate' && Object.hasOwn(record, 'expression')) {
    return { ...record, expression: record.expression };
  }
  if (record.kind === 'derived' && Object.hasOwn(record, 'expression')) {
    if (isValueExpression(record.expression) && containsValueField(record.expression)) {
      return {
        kind: 'aggregate',
        expression: { kind: 'first', value: record.expression, requireConsistent: true },
      };
    }
    return { ...record, expression: record.expression };
  }
  if (isAggregateColumnExpression(value)) return { kind: 'aggregate', expression: value };
  // A source field in a grouped cell means one value per group. Materialize it
  // as a consistency-checked first value so ambiguous groups fail closed.
  if (isValueExpression(value) && containsValueField(value)) {
    return {
      kind: 'aggregate',
      expression: { kind: 'first', value, requireConsistent: true },
    };
  }
  return { kind: 'derived', expression: value };
}

export const AggregateColumnValueSchema: z.ZodType<ReportAggregateColumnValue> = z.preprocess(
  normalizeAggregateColumnValue,
  z.union([
    z.object({ kind: z.literal('group_key'), keyId: z.string().min(1) }),
    // The row's position after having, sort and limit, from 1: a rank column (순위).
    z.object({ kind: z.literal('row_number') }),
    z.object({ kind: z.literal('aggregate'), expression: ReportAggregateExpressionSchema }),
    z.object({ kind: z.literal('derived'), expression: ReportDerivedExpressionSchema }),
    // Direct expression forms are included so the Codex wire schema can
    // decode them before the preprocess adds the runtime wrapper.
    ReportAggregateExpressionSchema,
    OutputValueSchema,
  ]),
) as z.ZodType<ReportAggregateColumnValue>;

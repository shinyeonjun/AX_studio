import { z } from 'zod';

export type ReportPrimitive = string | number | boolean | null;

export type ReportValueExpression =
  | { kind: 'field'; path: string }
  | { kind: 'literal'; value: ReportPrimitive }
  | {
    kind: 'arithmetic';
    operation: 'add' | 'subtract' | 'multiply' | 'divide';
    left: ReportValueExpression;
    right: ReportValueExpression;
  }
  | { kind: 'coalesce'; values: ReportValueExpression[] }
  | { kind: 'concat'; values: ReportValueExpression[]; separator?: string };

export type ReportPredicate =
  | {
    kind: 'compare';
    operation: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
    left: ReportValueExpression;
    right: ReportValueExpression;
  }
  | { kind: 'in'; value: ReportValueExpression; values: ReportValueExpression[] }
  | { kind: 'and' | 'or'; items: ReportPredicate[] }
  | { kind: 'not'; item: ReportPredicate }
  | { kind: 'is_null'; value: ReportValueExpression; negate?: boolean };

interface FilteredAggregate {
  where?: ReportPredicate;
}

export type ReportAggregateExpression =
  | ({ kind: 'count' } & FilteredAggregate)
  | ({ kind: 'count_distinct'; value: ReportValueExpression } & FilteredAggregate)
  | ({ kind: 'sum' | 'average' | 'min' | 'max'; value: ReportValueExpression } & FilteredAggregate)
  | ({
    kind: 'sum_distinct';
    value: ReportValueExpression;
    distinctBy: ReportValueExpression;
  } & FilteredAggregate)
  | ({ kind: 'first'; value: ReportValueExpression; requireConsistent?: boolean } & FilteredAggregate)
  | {
    kind: 'arithmetic';
    operation: 'add' | 'subtract' | 'multiply' | 'divide';
    left: ReportAggregateExpression;
    right: ReportAggregateExpression;
  };

export interface ReportFormat {
  style: 'text' | 'integer' | 'decimal' | 'currency' | 'percent' | 'date';
  decimals?: number;
  currency?: string;
  prefix?: string;
  suffix?: string;
}

export interface ReportJoin {
  source: string;
  left: string;
  right: string;
  type: 'inner' | 'left';
  cardinality: 'one' | 'many';
  /** Candidate-row filter applied before cardinality validation. */
  where?: ReportPredicate;
}

export interface ReportScalarSpec {
  id: string;
  expression: ReportAggregateExpression;
  format?: ReportFormat;
}

export interface ReportGroupKeySpec {
  id: string;
  value: ReportValueExpression;
}

export type ReportAggregateColumnValue =
  | { kind: 'group_key'; keyId: string }
  | { kind: 'aggregate'; expression: ReportAggregateExpression }
  | { kind: 'derived'; expression: ReportOutputValueExpression };

export interface ReportAggregateColumnSpec {
  id: string;
  value: ReportAggregateColumnValue;
  format?: ReportFormat;
}

export interface ReportSortSpec {
  columnId: string;
  direction: 'asc' | 'desc';
}

export type ReportOutputValueExpression =
  | { kind: 'column'; columnId: string }
  | { kind: 'literal'; value: ReportPrimitive }
  | {
    kind: 'arithmetic';
    operation: 'add' | 'subtract' | 'multiply' | 'divide';
    left: ReportOutputValueExpression;
    right: ReportOutputValueExpression;
  }
  | { kind: 'coalesce'; values: ReportOutputValueExpression[] }
  | { kind: 'concat'; values: ReportOutputValueExpression[]; separator?: string }
  | {
    kind: 'case';
    branches: Array<{ when: ReportOutputPredicate; value: ReportOutputValueExpression }>;
    fallback: ReportOutputValueExpression;
  };

export type ReportOutputPredicate =
  | {
    kind: 'compare';
    operation: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
    left: ReportOutputValueExpression;
    right: ReportOutputValueExpression;
  }
  | { kind: 'in'; value: ReportOutputValueExpression; values: ReportOutputValueExpression[] }
  | { kind: 'and' | 'or'; items: ReportOutputPredicate[] }
  | { kind: 'not'; item: ReportOutputPredicate }
  | { kind: 'is_null'; value: ReportOutputValueExpression; negate?: boolean };

export interface ReportAggregateTableSpec {
  kind: 'aggregate';
  id: string;
  filter?: ReportPredicate;
  groupBy: ReportGroupKeySpec[];
  columns: ReportAggregateColumnSpec[];
  sort?: ReportSortSpec[];
  limit?: number;
}

export interface ReportViewTableSpec {
  kind: 'view';
  id: string;
  sourceTable: string;
  filter?: ReportOutputPredicate;
  columns?: string[];
  sort?: ReportSortSpec[];
  limit?: number;
}

export type ReportTableSpec = ReportAggregateTableSpec | ReportViewTableSpec;

export type ReportTextSpec =
  | { id: string; kind: 'computed'; template: string }
  | { id: string; kind: 'invariant'; value: string }
  | { id: string; kind: 'phase'; exampleValue: string; targetMetadataKey: string };

export interface ReportPlan {
  schemaVersion: 1;
  baseSource: string;
  joins: ReportJoin[];
  filter?: ReportPredicate;
  scalars: ReportScalarSpec[];
  tables: ReportTableSpec[];
  texts: ReportTextSpec[];
}

export interface ReportSourceSnapshot {
  id: string;
  rows: Array<Record<string, unknown>>;
  complete: boolean;
  fingerprint?: string;
  provenance?: {
    source: string;
    startedAt: string;
    completedAt: string;
    requestedPeriod: { start: string; endInclusive: string; label: string };
    /** Complete transport does not establish historical or cross-source consistency. */
    consistency: 'unverified';
  };
}

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

export const ReportAggregateExpressionSchema: z.ZodType<ReportAggregateExpression> = z.lazy(() => z.union([
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
]));

export const ReportFormatSchema = z.object({
  style: z.enum(['text', 'integer', 'decimal', 'currency', 'percent', 'date']),
  decimals: z.number().int().min(0).max(8).optional(),
  currency: z.string().min(1).max(12).optional(),
  prefix: z.string().max(40).optional(),
  suffix: z.string().max(40).optional(),
});

const SortSchema = z.object({ columnId: z.string().min(1), direction: z.enum(['asc', 'desc']) });
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
const OutputPredicateSchema: z.ZodType<ReportOutputPredicate> = z.lazy(() => z.union([
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

export const ReportPlanSchema: z.ZodType<ReportPlan> = z.object({
  schemaVersion: z.literal(1),
  baseSource: z.string().min(1),
  joins: z.array(z.object({
    source: z.string().min(1),
    left: z.string().min(1),
    right: z.string().min(1),
    type: z.enum(['inner', 'left']),
    cardinality: z.enum(['one', 'many']),
    where: ReportPredicateSchema.optional(),
  })).max(20),
  filter: ReportPredicateSchema.optional(),
  scalars: z.array(z.object({
    id: z.string().min(1),
    expression: ReportAggregateExpressionSchema,
    format: ReportFormatSchema.optional(),
  })).max(100),
  tables: z.array(z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('aggregate'),
      id: z.string().min(1),
      filter: ReportPredicateSchema.optional(),
      groupBy: z.array(z.object({ id: z.string().min(1), value: ReportValueExpressionSchema })).min(1).max(20),
      columns: z.array(z.object({
        id: z.string().min(1),
        value: z.union([
          z.object({ kind: z.literal('group_key'), keyId: z.string().min(1) }),
          z.object({ kind: z.literal('aggregate'), expression: ReportAggregateExpressionSchema }),
          z.object({ kind: z.literal('derived'), expression: OutputValueSchema }),
        ]),
        format: ReportFormatSchema.optional(),
      })).min(1).max(50),
      sort: z.array(SortSchema).max(10).optional(),
      limit: z.number().int().min(1).max(10_000).optional(),
    }),
    z.object({
      kind: z.literal('view'),
      id: z.string().min(1),
      sourceTable: z.string().min(1),
      filter: OutputPredicateSchema.optional(),
      columns: z.array(z.string().min(1)).max(50).optional(),
      sort: z.array(SortSchema).max(10).optional(),
      limit: z.number().int().min(1).max(10_000).optional(),
    }),
  ])).max(50),
  texts: z.array(z.discriminatedUnion('kind', [
    z.object({ id: z.string().min(1), kind: z.literal('computed'), template: z.string().max(20_000) }),
    z.object({ id: z.string().min(1), kind: z.literal('invariant'), value: z.string().max(20_000) }),
    z.object({
      id: z.string().min(1),
      kind: z.literal('phase'),
      exampleValue: z.string().max(20_000),
      targetMetadataKey: z.string().min(1).max(200),
    }),
  ])).max(100),
});

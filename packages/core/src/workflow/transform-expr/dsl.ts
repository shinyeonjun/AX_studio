import { z } from 'zod';
import { ConditionExprSchema, depthLimited } from '../condition-expr/schema.js';
import { ScalarValueSchema } from '../../contracts/artifacts/table.js';

const SourceExprSchema = z.object({
  op: z.literal('source'),
  sourceId: z.string(),
});

const ColumnExprSchema = z.object({
  op: z.literal('column'),
  input: z.lazy(() => TransformExprSchema),
  name: z.string(),
});

const FilterExprSchema = z.object({
  op: z.literal('filter'),
  input: z.lazy(() => TransformExprSchema),
  where: ConditionExprSchema,
});

const AggregateFnSchema = z.enum(['count', 'sum', 'avg', 'min', 'max']);
export type AggregateFn = z.infer<typeof AggregateFnSchema>;

/** Bounds the size of one stored/LLM-authored group expression (not a business rule). */
const MAX_GROUP_AGGREGATES = 32;

const AggregateExprSchema = z.object({
  op: z.literal('aggregate'),
  input: z.lazy(() => TransformExprSchema),
  fn: AggregateFnSchema,
  column: z.string().optional(),
  /** Round the result to this many decimal places (reports usually show rounded averages). */
  round: z.number().int().min(0).max(6).optional(),
});

const GroupAggregateSchema = z.object({
  /** Output column header for this aggregate. */
  as: z.string().min(1),
  fn: AggregateFnSchema,
  column: z.string().optional(),
  round: z.number().int().min(0).max(6).optional(),
});
export type GroupAggregate = z.infer<typeof GroupAggregateSchema>;

/** Bounds the nesting of one group expression (region → category → ...), not a business rule. */
export const MAX_GROUP_THEN_BY = 2;

/**
 * Pivot-style grouping: one output row per distinct (trimmed, non-empty) value of `by`, in
 * first-appearance order, with the same aggregate semantics as `aggregate`. The key set comes
 * from the data at run time. `thenBy` nests further key columns (one row per distinct
 * combination, e.g. region then category). `totalRow` appends one row aggregated over every
 * input row, its label in the first key column and the other key columns left empty.
 */
const GroupExprSchema = z.object({
  op: z.literal('group'),
  input: z.lazy(() => TransformExprSchema),
  by: z.string().min(1),
  /** Output header of the key column; defaults to `by`. */
  keyAs: z.string().min(1).optional(),
  thenBy: z.array(z.object({ by: z.string().min(1), keyAs: z.string().min(1).optional() })).min(1).max(MAX_GROUP_THEN_BY).optional(),
  aggregates: z.array(GroupAggregateSchema).min(1).max(MAX_GROUP_AGGREGATES),
  totalRow: z.object({ label: z.string().min(1) }).optional(),
});

const RatioExprSchema = z.object({
  op: z.literal('ratio'),
  numerator: z.lazy(() => TransformExprSchema),
  denominator: z.lazy(() => TransformExprSchema),
  multiplyBy: z.number().default(1),
  round: z.number().int().min(0).max(6).optional(),
});

const LookupExprSchema = z.object({
  op: z.literal('lookup'),
  input: z.lazy(() => TransformExprSchema),
  keyColumn: z.string(),
  keyValue: ScalarValueSchema,
  valueColumn: z.string(),
});

const SelectExprSchema = z.object({
  op: z.literal('select'),
  input: z.lazy(() => TransformExprSchema),
  columns: z.array(z.string()).min(1),
});

const SortExprSchema = z.object({
  op: z.literal('sort'),
  input: z.lazy(() => TransformExprSchema),
  by: z.array(z.object({
    column: z.string(),
    direction: z.enum(['asc', 'desc']),
  })).min(1),
});

const LimitExprSchema = z.object({
  op: z.literal('limit'),
  input: z.lazy(() => TransformExprSchema),
  count: z.number().int().positive().max(500),
});

export const TransformExprSchema: z.ZodType<TransformExpr> = depthLimited(z.discriminatedUnion('op', [
  SourceExprSchema,
  ColumnExprSchema,
  FilterExprSchema,
  AggregateExprSchema,
  GroupExprSchema,
  RatioExprSchema,
  LookupExprSchema,
  SelectExprSchema,
  SortExprSchema,
  LimitExprSchema,
]), 'TransformExpr');

export type TransformExpr =
  | z.infer<typeof SourceExprSchema>
  | { op: 'column'; input: TransformExpr; name: string }
  | { op: 'filter'; input: TransformExpr; where: z.infer<typeof ConditionExprSchema> }
  | { op: 'aggregate'; input: TransformExpr; fn: AggregateFn; column?: string; round?: number }
  | {
    op: 'group';
    input: TransformExpr;
    by: string;
    keyAs?: string;
    thenBy?: Array<{ by: string; keyAs?: string }>;
    aggregates: GroupAggregate[];
    totalRow?: { label: string };
  }
  | { op: 'ratio'; numerator: TransformExpr; denominator: TransformExpr; multiplyBy?: number; round?: number }
  | { op: 'lookup'; input: TransformExpr; keyColumn: string; keyValue: z.infer<typeof ScalarValueSchema>; valueColumn: string }
  | { op: 'select'; input: TransformExpr; columns: string[] }
  | { op: 'sort'; input: TransformExpr; by: Array<{ column: string; direction: 'asc' | 'desc' }> }
  | { op: 'limit'; input: TransformExpr; count: number };

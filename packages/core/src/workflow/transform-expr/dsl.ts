import { z } from 'zod';
import { ConditionExprSchema } from '../../runtime/condition-expr.js';
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

const AggregateExprSchema = z.object({
  op: z.literal('aggregate'),
  input: z.lazy(() => TransformExprSchema),
  fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  column: z.string().optional(),
});

const RatioExprSchema = z.object({
  op: z.literal('ratio'),
  numerator: z.lazy(() => TransformExprSchema),
  denominator: z.lazy(() => TransformExprSchema),
  multiplyBy: z.number().default(1),
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

export const TransformExprSchema: z.ZodType<TransformExpr> = z.discriminatedUnion('op', [
  SourceExprSchema,
  ColumnExprSchema,
  FilterExprSchema,
  AggregateExprSchema,
  RatioExprSchema,
  LookupExprSchema,
  SelectExprSchema,
  SortExprSchema,
  LimitExprSchema,
]);

export type TransformExpr =
  | z.infer<typeof SourceExprSchema>
  | { op: 'column'; input: TransformExpr; name: string }
  | { op: 'filter'; input: TransformExpr; where: z.infer<typeof ConditionExprSchema> }
  | { op: 'aggregate'; input: TransformExpr; fn: 'count' | 'sum' | 'avg' | 'min' | 'max'; column?: string }
  | { op: 'ratio'; numerator: TransformExpr; denominator: TransformExpr; multiplyBy?: number }
  | { op: 'lookup'; input: TransformExpr; keyColumn: string; keyValue: z.infer<typeof ScalarValueSchema>; valueColumn: string }
  | { op: 'select'; input: TransformExpr; columns: string[] }
  | { op: 'sort'; input: TransformExpr; by: Array<{ column: string; direction: 'asc' | 'desc' }> }
  | { op: 'limit'; input: TransformExpr; count: number };

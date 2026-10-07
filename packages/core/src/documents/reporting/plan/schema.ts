import { z } from 'zod';
import type { ReportPlan } from './schema/types.js';
import {
  ReportValueExpressionSchema,
  ReportPredicateSchema,
  ReportScalarExpressionSchema,
  OutputPredicateSchema,
  AggregateColumnValueSchema,
} from './schema/expressions.js';
import { normalizeReportPlan } from './schema/normalize-plan.js';

export { isReportAggregateExpression } from './schema/types.js';
export type {
  ReportPrimitive,
  ReportValueExpression,
  ReportPredicate,
  ReportAggregateExpression,
  ReportScalarExpression,
  ReportFormat,
  ReportAggregateColumnValue,
  ReportSortSpec,
  ReportOutputValueExpression,
  ReportDerivedExpression,
  ReportDerivedPredicate,
  ReportOutputPredicate,
  ReportAggregateTableSpec,
  ReportDataset,
  ReportPlan,
  ReportSourceCoverage,
  ReportSourceSnapshot,
} from './schema/types.js';

const ReportFormatSchema = z.object({
  style: z.enum(['text', 'integer', 'decimal', 'currency', 'percent', 'date']),
  decimals: z.number().int().min(0).max(8).optional(),
  currency: z.string().min(1).max(12).optional(),
  prefix: z.string().max(40).optional(),
  suffix: z.string().max(40).optional(),
});

const SortSchema = z.object({ columnId: z.string().min(1), direction: z.enum(['asc', 'desc']) });

const ReportDatasetSchema = z.object({
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
});

export const ReportPlanSchema: z.ZodType<ReportPlan> = z.preprocess(normalizeReportPlan, ReportDatasetSchema.extend({
  schemaVersion: z.literal(1),
  datasets: z.array(ReportDatasetSchema.extend({ id: z.string().min(1).max(160) })).max(50).optional(),
  scalars: z.array(z.object({
    id: z.string().min(1),
    dataset: z.string().min(1).max(160).optional(),
    expression: ReportScalarExpressionSchema,
    format: ReportFormatSchema.optional(),
  })).max(100),
  tables: z.array(z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('aggregate'),
      id: z.string().min(1),
      dataset: z.string().min(1).max(160).optional(),
      filter: ReportPredicateSchema.optional(),
      groupBy: z.array(z.object({ id: z.string().min(1), value: ReportValueExpressionSchema })).min(1).max(20),
      columns: z.array(z.object({
        id: z.string().min(1),
        value: AggregateColumnValueSchema,
        format: ReportFormatSchema.optional(),
      })).min(1).max(50),
      having: OutputPredicateSchema.optional(),
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
})) as z.ZodType<ReportPlan>;

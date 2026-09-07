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

/**
 * A scalar slot may combine row aggregates with metadata/value expressions in
 * prose (for example, "{{period}}: {{sum}} from {{count}} rows"). The model
 * naturally emits the same concat/coalesce/arithmetic tags used by value
 * expressions, so retain a recursive mixed form at the plan boundary.
 */
export type ReportScalarCompositeExpression =
  | {
    kind: 'arithmetic';
    operation: 'add' | 'subtract' | 'multiply' | 'divide';
    left: ReportScalarExpression;
    right: ReportScalarExpression;
  }
  | { kind: 'coalesce'; values: ReportScalarExpression[] }
  | { kind: 'concat'; values: ReportScalarExpression[]; separator?: string };

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

/** A scalar slot may be an aggregate over rows or a value derived directly
 * from one joined row (most commonly host metadata such as the period label). */
export type ReportScalarExpression = ReportAggregateExpression | ReportValueExpression | ReportScalarCompositeExpression;

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
  dataset?: string;
  expression: ReportScalarExpression;
  format?: ReportFormat;
}

export interface ReportGroupKeySpec {
  id: string;
  value: ReportValueExpression;
}

export type ReportAggregateColumnValue =
  | { kind: 'group_key'; keyId: string }
  | { kind: 'aggregate'; expression: ReportAggregateExpression }
  | { kind: 'derived'; expression: ReportDerivedExpression };

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

/** Models sometimes mix aggregate values and already-computed columns in a
 * grouped cell (for example, revenue-column / sum-of-target). Evaluate those
 * expressions against both the current aggregate row and its source rows. */
export type ReportDerivedCompositeExpression =
  | {
    kind: 'arithmetic';
    operation: 'add' | 'subtract' | 'multiply' | 'divide';
    left: ReportDerivedExpression;
    right: ReportDerivedExpression;
  }
  | { kind: 'coalesce'; values: ReportDerivedExpression[] }
  | { kind: 'concat'; values: ReportDerivedExpression[]; separator?: string }
  | {
    kind: 'case';
    branches: Array<{ when: ReportDerivedPredicate; value: ReportDerivedExpression }>;
    fallback: ReportDerivedExpression;
  };

/** A grouped cell may reuse a scalar that was computed once for the selected
 * dataset (for example, a regional share of the report-wide revenue). */
export type ReportScalarReferenceExpression = { kind: 'scalar'; scalarId: string };

export type ReportDerivedExpression = ReportOutputValueExpression
  | ReportAggregateExpression
  | ReportScalarReferenceExpression
  | ReportDerivedCompositeExpression;

/** A grouped derived expression may classify a row using another aggregate
 * (for example, `sum(revenue) / first(target) < 0.5`) rather than only a
 * previously materialized output column. */
export type ReportDerivedPredicate =
  | {
    kind: 'compare';
    operation: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
    left: ReportDerivedExpression;
    right: ReportDerivedExpression;
  }
  | { kind: 'in'; value: ReportDerivedExpression; values: ReportDerivedExpression[] }
  | { kind: 'and' | 'or'; items: ReportDerivedPredicate[] }
  | { kind: 'not'; item: ReportDerivedPredicate }
  | { kind: 'is_null'; value: ReportDerivedExpression; negate?: boolean };

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

/** Distinguish row aggregates from value/output expressions at runtime. The
 * `arithmetic` tag is shared, so inspect both operands recursively. */
export function isReportAggregateExpression(
  expression: ReportScalarExpression | ReportDerivedExpression | ReportOutputValueExpression,
): expression is ReportAggregateExpression {
  switch (expression.kind) {
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
      return isReportAggregateExpression(expression.left)
        && isReportAggregateExpression(expression.right);
    default:
      return false;
  }
}

export interface ReportAggregateTableSpec {
  kind: 'aggregate';
  id: string;
  dataset?: string;
  filter?: ReportPredicate;
  groupBy: ReportGroupKeySpec[];
  columns: ReportAggregateColumnSpec[];
  /** Predicate evaluated after grouped columns are materialized. */
  having?: ReportOutputPredicate;
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

export interface ReportDataset {
  baseSource: string;
  joins: ReportJoin[];
  filter?: ReportPredicate;
}

export interface ReportPlan extends ReportDataset {
  schemaVersion: 1;
  datasets?: Array<ReportDataset & { id: string }>;
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

export const ReportAggregateExpressionSchema = z.lazy(() => z.preprocess(
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

export const ReportDerivedExpressionSchema: z.ZodType<ReportDerivedExpression> = z.lazy(() => z.union([
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
  if (record.kind === 'group_key') return value;
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

const AggregateColumnValueSchema: z.ZodType<ReportAggregateColumnValue> = z.preprocess(
  normalizeAggregateColumnValue,
  z.union([
    z.object({ kind: z.literal('group_key'), keyId: z.string().min(1) }),
    z.object({ kind: z.literal('aggregate'), expression: ReportAggregateExpressionSchema }),
    z.object({ kind: z.literal('derived'), expression: ReportDerivedExpressionSchema }),
    // Direct expression forms are included so the Codex wire schema can
    // decode them before the preprocess adds the runtime wrapper.
    ReportAggregateExpressionSchema,
    OutputValueSchema,
  ]),
) as z.ZodType<ReportAggregateColumnValue>;

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

function normalizeReportTemplate(value: string, scalarIds: ReadonlySet<string> = new Set()): string {
  const namespace = (value: string): string => {
    if (value === 'scalar' || value === 'scalars') return 'scalar';
    if (value === 'table' || value === 'tables') return 'table';
    if (value === 'meta' || value === 'metadata') return 'meta';
    return value;
  };
  const canonicalDouble = value.replace(/\{\{\s*(scalar|scalars|table|tables|meta|metadata)[:.]([^{}]+?)\s*\}\}/g,
    (_match, name: string, token: string) => `{{${namespace(name)}.${token.trim()}}}`);
  const canonicalNamespaced = canonicalDouble.replace(/(?<!\{)\{\s*(scalar|scalars|table|tables|meta|metadata)[:.]([^{}]+?)\s*\}(?!\})/g,
    (_match, name: string, token: string) => `{{${namespace(name)}.${token.trim()}}}`);
  const normalizeBare = (match: string, token: string): string => {
    const trimmed = token.trim();
    return scalarIds.has(trimmed) ? `{{scalar.${trimmed}}}` : match;
  };
  const withDoubleBare = canonicalNamespaced.replace(/(?<!\{)\{\{\s*([^{}]+?)\s*\}\}(?!\})/g, normalizeBare);
  return withDoubleBare.replace(/(?<!\{)\{\s*([^{}]+?)\s*\}(?!\})/g, normalizeBare);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The model often uses the natural row-column spelling (`paid_at`) even
 * though execution stores each source row under its alias (`orders.paid_at`).
 * Canonicalize that shorthand once at the plan boundary so filters, joins,
 * aggregates, and grouped cells all see the same row shape.
 */
function normalizeFieldPath(path: unknown, source: string, aliases: Set<string>): unknown {
  if (typeof path !== 'string') return path;
  const trimmed = path.trim();
  if (!trimmed || !source) return trimmed;
  const parts = trimmed.split('.');
  const root = parts[0]!;
  // Source fields are flat paths (`alias.column`). A model can nevertheless
  // serialize a joined field as `baseAlias.joinedAlias.column`, treating the
  // row object as if joins were nested objects. If the middle segment is a
  // known source alias, collapse that structural spelling to the canonical
  // joined alias; unknown paths remain untouched and fail closed at execute.
  const nestedAliasIndex = parts.slice(1).findIndex((part) => part !== 'meta' && aliases.has(part));
  if (nestedAliasIndex >= 0) {
    const aliasIndex = nestedAliasIndex + 1;
    const fieldParts = parts.slice(aliasIndex + 1);
    if (fieldParts.length) return `${parts[aliasIndex]}.${fieldParts.join('.')}`;
  }
  return root === 'meta' || aliases.has(root) ? trimmed : `${source}.${trimmed}`;
}

/**
 * A join's left expression is evaluated before the candidate source is added
 * to the row. Models occasionally copy the candidate alias into that side
 * (`customers.customer_id` while joining `customers`). Resolve that bounded
 * spelling to the nearest source already available in the left-deep join
 * order; genuinely unknown paths remain unchanged and fail during execution.
 */
function normalizeJoinLeftPath(
  path: unknown,
  source: string,
  baseSource: string,
  previousSources: string[],
  aliases: Set<string>,
): unknown {
  const normalized = normalizeFieldPath(path, baseSource, aliases);
  if (typeof normalized !== 'string' || previousSources.includes(source)) return normalized;
  const prefix = `${source}.`;
  if (!normalized.startsWith(prefix)) return normalized;
  const suffix = normalized.slice(prefix.length);
  const fallback = previousSources.at(-1) ?? baseSource;
  return suffix ? `${fallback}.${suffix}` : normalized;
}

function normalizeValueExpression(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'field':
      return { ...value, path: normalizeFieldPath(value.path, source, aliases) };
    case 'literal':
      return value;
    case 'arithmetic':
      return {
        ...value,
        left: normalizeValueExpression(value.left, source, aliases),
        right: normalizeValueExpression(value.right, source, aliases),
      };
    case 'coalesce':
    case 'concat':
      return {
        ...value,
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeValueExpression(item, source, aliases))
          : value.values,
      };
    default:
      return value;
  }
}

function normalizePredicate(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'compare':
      return {
        ...value,
        left: normalizeValueExpression(value.left, source, aliases),
        right: normalizeValueExpression(value.right, source, aliases),
      };
    case 'in':
      return {
        ...value,
        value: normalizeValueExpression(value.value, source, aliases),
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeValueExpression(item, source, aliases))
          : value.values,
      };
    case 'and':
    case 'or':
      return {
        ...value,
        items: Array.isArray(value.items)
          ? value.items.map((item) => normalizePredicate(item, source, aliases))
          : value.items,
      };
    case 'not':
      return { ...value, item: normalizePredicate(value.item, source, aliases) };
    case 'is_null':
      return { ...value, value: normalizeValueExpression(value.value, source, aliases) };
    default:
      return value;
  }
}

function normalizeAggregateExpression(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return {
        ...value,
        left: normalizeAggregateExpression(value.left, source, aliases),
        right: normalizeAggregateExpression(value.right, source, aliases),
      };
    case 'count':
      return { ...value, ...(value.where ? { where: normalizePredicate(value.where, source, aliases) } : {}) };
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'first':
      return {
        ...value,
        value: normalizeValueExpression(value.value, source, aliases),
        ...(value.where ? { where: normalizePredicate(value.where, source, aliases) } : {}),
      };
    case 'sum_distinct':
      return {
        ...value,
        value: normalizeValueExpression(value.value, source, aliases),
        distinctBy: normalizeValueExpression(value.distinctBy, source, aliases),
        ...(value.where ? { where: normalizePredicate(value.where, source, aliases) } : {}),
      };
    default:
      return value;
  }
}

function normalizeScalarExpression(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'field':
    case 'literal':
      return normalizeValueExpression(value, source, aliases);
    case 'count':
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'sum_distinct':
    case 'first':
      return normalizeAggregateExpression(value, source, aliases);
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return {
        ...value,
        left: normalizeScalarExpression(value.left, source, aliases),
        right: normalizeScalarExpression(value.right, source, aliases),
      };
    case 'coalesce':
    case 'concat':
      return {
        ...value,
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeScalarExpression(item, source, aliases))
          : value.values,
      };
    default:
      return value;
  }
}

function normalizeDerivedPredicate(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'compare':
      return {
        ...value,
        left: normalizeDerivedExpression(value.left, source, aliases),
        right: normalizeDerivedExpression(value.right, source, aliases),
      };
    case 'in':
      return {
        ...value,
        value: normalizeDerivedExpression(value.value, source, aliases),
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeDerivedExpression(item, source, aliases))
          : value.values,
      };
    case 'and':
    case 'or':
      return {
        ...value,
        items: Array.isArray(value.items)
          ? value.items.map((item) => normalizeDerivedPredicate(item, source, aliases))
          : value.items,
      };
    case 'not':
      return { ...value, item: normalizeDerivedPredicate(value.item, source, aliases) };
    case 'is_null':
      return { ...value, value: normalizeDerivedExpression(value.value, source, aliases) };
    default:
      return value;
  }
}

function normalizeDerivedExpression(
  value: unknown,
  source: string,
  aliases: Set<string>,
  preserveColumnWrapper = false,
): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'group_key':
      return value;
    case 'aggregate':
      // `aggregate` and `derived` are column-value wrappers. Models can also
      // repeat them inside a derived arithmetic/case expression, where the
      // runtime grammar expects the expression itself. Preserve the outer
      // column wrapper but unwrap nested wrappers at expression boundaries.
      return preserveColumnWrapper
        ? { ...value, expression: normalizeAggregateExpression(value.expression, source, aliases) }
        : normalizeAggregateExpression(value.expression, source, aliases);
    case 'derived':
      return preserveColumnWrapper
        ? { ...value, expression: normalizeDerivedExpression(value.expression, source, aliases) }
        : normalizeDerivedExpression(value.expression, source, aliases);
    case 'field':
      return normalizeValueExpression(value, source, aliases);
    case 'count':
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'sum_distinct':
    case 'first':
      return normalizeAggregateExpression(value, source, aliases);
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return {
        ...value,
        left: normalizeDerivedExpression(value.left, source, aliases),
        right: normalizeDerivedExpression(value.right, source, aliases),
      };
    case 'coalesce':
    case 'concat':
      return {
        ...value,
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeDerivedExpression(item, source, aliases))
          : value.values,
      };
    case 'case':
      return {
        ...value,
        branches: Array.isArray(value.branches)
          ? value.branches.map((branch) => isRecord(branch)
            ? { ...branch, when: normalizeDerivedPredicate(branch.when, source, aliases), value: normalizeDerivedExpression(branch.value, source, aliases) }
            : branch)
          : value.branches,
        fallback: normalizeDerivedExpression(value.fallback, source, aliases),
      };
    default:
      return value;
  }
}

interface ReportPlanDatasetContext {
  baseSource: string;
  aliases: Set<string>;
}

function datasetContext(value: unknown, fallbackBaseSource: string): ReportPlanDatasetContext {
  const record = isRecord(value) ? value : {};
  const baseSource = typeof record.baseSource === 'string' && record.baseSource.length > 0
    ? record.baseSource : fallbackBaseSource;
  const aliases = new Set<string>(['meta', baseSource]);
  if (Array.isArray(record.joins)) {
    for (const join of record.joins) {
      if (isRecord(join) && typeof join.source === 'string' && join.source.length > 0) aliases.add(join.source);
    }
  }
  return { baseSource, aliases };
}

function normalizeDataset(value: unknown, fallbackBaseSource: string): unknown {
  if (!isRecord(value)) return value;
  const context = datasetContext(value, fallbackBaseSource);
  const previousSources = [context.baseSource];
  const joins = Array.isArray(value.joins) ? value.joins.map((join) => {
    if (!isRecord(join)) return join;
    const source = typeof join.source === 'string' && join.source.length > 0 ? join.source : context.baseSource;
    const normalizedJoin = {
      ...join,
      left: normalizeJoinLeftPath(join.left, source, context.baseSource, previousSources, context.aliases),
      // The right side is evaluated against the candidate row itself, so a
      // bare path is already canonical for that source.
      right: typeof join.right === 'string' ? join.right.trim() : join.right,
      ...(join.where ? { where: normalizePredicate(join.where, source, context.aliases) } : {}),
    };
    previousSources.push(source);
    return normalizedJoin;
  }) : value.joins;
  return {
    ...value,
    joins,
    ...(value.filter ? { filter: normalizePredicate(value.filter, context.baseSource, context.aliases) } : {}),
  };
}

function normalizeReportPlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const root = normalizeDataset(record, typeof record.baseSource === 'string' ? record.baseSource : '') as Record<string, unknown>;
  const normalizedDatasets = Array.isArray(record.datasets)
    ? record.datasets.map((dataset) => normalizeDataset(dataset, root.baseSource as string))
    : record.datasets;
  const contexts = new Map<string, ReportPlanDatasetContext>();
  contexts.set('__root__', datasetContext(root, root.baseSource as string));
  if (Array.isArray(normalizedDatasets)) {
    for (const dataset of normalizedDatasets) {
      if (isRecord(dataset) && typeof dataset.id === 'string') contexts.set(dataset.id, datasetContext(dataset, root.baseSource as string));
    }
  }
  const contextFor = (id: unknown): ReportPlanDatasetContext => (
    typeof id === 'string' && contexts.get(id) ? contexts.get(id)! : contexts.get('__root__')!
  );
  const datasetSelector = (id: unknown): string | undefined => {
    if (typeof id !== 'string') return undefined;
    const trimmed = id.trim();
    return trimmed && trimmed !== root.baseSource ? trimmed : undefined;
  };
  const scalars = Array.isArray(record.scalars) ? record.scalars.map((scalar) => {
    if (!isRecord(scalar)) return scalar;
    const context = contextFor(scalar.dataset);
    const dataset = datasetSelector(scalar.dataset);
    return {
      ...scalar,
      dataset,
      expression: normalizeScalarExpression(scalar.expression, context.baseSource, context.aliases),
    };
  }) : record.scalars;
  const tables = Array.isArray(record.tables) ? record.tables.map((table) => {
    if (!table || typeof table !== 'object' || Array.isArray(table)) return table;
    const candidate = table as Record<string, unknown>;
    if (candidate.kind !== 'aggregate' || !Array.isArray(candidate.groupBy) || !Array.isArray(candidate.columns)) {
      return table;
    }
    const context = contextFor(candidate.dataset);
    const dataset = datasetSelector(candidate.dataset);
    const groupKeyIds = new Set(candidate.groupBy.flatMap((group) => (
      group && typeof group === 'object' && !Array.isArray(group) && typeof (group as Record<string, unknown>).id === 'string'
        ? [(group as Record<string, unknown>).id as string] : []
    )));
    return {
      ...candidate,
      dataset,
      ...(candidate.filter ? { filter: normalizePredicate(candidate.filter, context.baseSource, context.aliases) } : {}),
      groupBy: candidate.groupBy.map((group) => isRecord(group)
        ? { ...group, value: normalizeValueExpression(group.value, context.baseSource, context.aliases) }
        : group),
      columns: candidate.columns.map((column) => {
        if (!column || typeof column !== 'object' || Array.isArray(column)) return column;
        const columnRecord = column as Record<string, unknown>;
        const columnValue = columnRecord.value;
        if (!columnValue || typeof columnValue !== 'object' || Array.isArray(columnValue)) return column;
        const normalizedValue = normalizeDerivedExpression(columnValue, context.baseSource, context.aliases, true);
        const valueRecord = columnValue as Record<string, unknown>;
        const normalizedColumn = { ...columnRecord, value: normalizedValue };
        const normalizedRecord = isRecord(normalizedValue) ? normalizedValue : valueRecord;
        return normalizedRecord.kind === 'group_key'
          && (typeof valueRecord.keyId !== 'string' || valueRecord.keyId.length === 0)
          && typeof columnRecord.id === 'string'
          && groupKeyIds.has(columnRecord.id)
          ? { ...normalizedColumn, value: { ...normalizedRecord, keyId: columnRecord.id } }
          : normalizedColumn;
      }),
    };
  }) : record.tables;
  const declaredScalarIds = new Set(
    (Array.isArray(scalars) ? scalars : [])
      .filter((scalar): scalar is Record<string, unknown> => isRecord(scalar) && typeof scalar.id === 'string')
      .map((scalar) => scalar.id as string),
  );
  const texts = Array.isArray(record.texts) ? record.texts.map((text) => {
    if (!text || typeof text !== 'object' || Array.isArray(text)) return text;
    const candidate = text as Record<string, unknown>;
    if (candidate.kind !== 'computed' || typeof candidate.template !== 'string') return text;
    const template = normalizeReportTemplate(candidate.template, declaredScalarIds);
    // A model can label visibly static prose as computed. Treat only
    // nonnumeric, tokenless text as invariant; numeric/date text remains
    // rejected by the reusable-plan validator instead of being frozen.
    if (!/[{}]/u.test(template) && !/\d/u.test(template)) {
      return { id: candidate.id, kind: 'invariant', value: template };
    }
    return { ...candidate, template };
  }) : record.texts;
  return {
    ...root,
    ...(normalizedDatasets === undefined ? {} : { datasets: normalizedDatasets }),
    ...(scalars === undefined ? {} : { scalars }),
    ...(tables === undefined ? {} : { tables }),
    ...(texts === undefined ? {} : { texts }),
  };
}

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

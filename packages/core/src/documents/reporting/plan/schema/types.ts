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
type ReportScalarCompositeExpression =
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

interface ReportJoin {
  source: string;
  left: string;
  right: string;
  type: 'inner' | 'left';
  cardinality: 'one' | 'many';
  /** Candidate-row filter applied before cardinality validation. */
  where?: ReportPredicate;
}

interface ReportScalarSpec {
  id: string;
  dataset?: string;
  expression: ReportScalarExpression;
  format?: ReportFormat;
}

interface ReportGroupKeySpec {
  id: string;
  value: ReportValueExpression;
}

export type ReportAggregateColumnValue =
  | { kind: 'group_key'; keyId: string }
  | { kind: 'aggregate'; expression: ReportAggregateExpression }
  | { kind: 'derived'; expression: ReportDerivedExpression };

interface ReportAggregateColumnSpec {
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
type ReportDerivedCompositeExpression =
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
type ReportScalarReferenceExpression = { kind: 'scalar'; scalarId: string };

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

interface ReportViewTableSpec {
  kind: 'view';
  id: string;
  sourceTable: string;
  filter?: ReportOutputPredicate;
  columns?: string[];
  sort?: ReportSortSpec[];
  limit?: number;
}

type ReportTableSpec = ReportAggregateTableSpec | ReportViewTableSpec;

type ReportTextSpec =
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

/** Host-owned source coverage, independent of a page's legacy complete flag. */
export interface ReportSourceCoverage {
  schemaVersion: 1;
  scope: 'whole_query';
  transport: 'complete' | 'partial';
  query: 'complete' | 'partial' | 'unknown';
  source: 'complete' | 'partial' | 'unknown';
  consistency: 'verified_snapshot' | 'immutable_source' | 'best_effort' | 'unverified';
  observedRows: number;
  pagesRead: number;
  queryFingerprint?: string;
  /** The requested report period is provenance, not an executed DB predicate. */
  periodFilterApplied: boolean;
  reason?: 'independent_offset_reads' | 'legacy_rdb_page_contract';
}

export interface ReportSourceSnapshot {
  id: string;
  rows: Array<Record<string, unknown>>;
  /** Legacy capture exhaustion; does not establish snapshot/source exactness. */
  complete: boolean;
  coverage?: ReportSourceCoverage;
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

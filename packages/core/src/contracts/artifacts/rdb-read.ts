import { z } from 'zod';

/** Host-issued description of the fixed SELECT used by the current RDB reader. */
export const RdbReadScopeSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('page'),
  queryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  table: z.string().min(1),
  /** Query capability only; use an account granted read permissions alone. */
  accessMode: z.literal('read_only'),
  projection: z.literal('all_columns'),
  predicate: z.literal('none'),
  pagination: z.literal('offset'),
  scalarPolicy: z.literal('preserve'),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
}).strict();

/**
 * A complete response page is not proof of complete query/source coverage.
 * Version 1 has no retained session or verified cursor, so it cannot assert
 * exact source coverage, even when the first page observes the apparent end.
 */
export const RdbReadCoverageSchema = z.object({
  schemaVersion: z.literal(1),
  page: z.literal('complete'),
  query: z.enum(['partial', 'unknown']),
  source: z.enum(['partial', 'unknown']),
  consistency: z.literal('best_effort'),
  reason: z.literal('independent_offset_reads'),
  observedRows: z.number().int().nonnegative(),
  hasMore: z.boolean(),
}).strict();

export type RdbReadScope = z.infer<typeof RdbReadScopeSchema>;
export type RdbReadCoverage = z.infer<typeof RdbReadCoverageSchema>;

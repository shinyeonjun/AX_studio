import { z } from 'zod';
import { ArtifactMetadataSchema } from './base.js';
import { ArtifactCompletenessSchema } from './completeness.js';
import { RdbReadCoverageSchema, RdbReadScopeSchema } from './rdb-read.js';

export const ScalarValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const TableColumnTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'currency',
  'percentage',
  'unknown',
]);

export const TableColumnSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: TableColumnTypeSchema,
  nullable: z.boolean().default(true),
  inferred: z.boolean().default(false),
  format: z.string().optional(),
  /** One-based physical worksheet column, independent of the normalized name. */
  sourceColumn: z.number().int().positive().optional(),
});

export const TableRowSchema = z.object({
  index: z.number().int().nonnegative(),
  key: z.string().optional(),
  values: z.record(ScalarValueSchema),
  /** Source scalars before trimming/coercion; absent for legacy or derived rows. */
  rawValues: z.record(ScalarValueSchema).optional(),
  /** One-based physical worksheet row; index remains a presentation position. */
  sourceRow: z.number().int().positive().optional(),
});

export const TableProfileFieldSchema = z.object({
  nullCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative().optional(),
  min: ScalarValueSchema.optional(),
  max: ScalarValueSchema.optional(),
  mean: z.number().optional(),
  sampleValues: z.array(ScalarValueSchema).max(12).default([]),
});

export const TableProfileSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  columns: z.record(TableProfileFieldSchema),
});

export const TableArtifactSchema = z.object({
  id: z.string(),
  kind: z.literal('table'),
  name: z.string().optional(),
  columns: z.array(TableColumnSchema),
  rows: z.array(TableRowSchema),
  profile: TableProfileSchema.optional(),
  truncated: z.boolean().default(false),
  /** Optional provider page origin for bounded reads. */
  offset: z.number().int().nonnegative().optional(),
  /** Next provider page origin; absent when this page is complete. */
  nextOffset: z.number().int().nonnegative().optional(),
  /** Legacy transport extent; RDB consumers must also inspect readScope/coverage. */
  completeness: ArtifactCompletenessSchema.optional(),
  /** Host-issued RDB query/page identity. Absent on legacy/non-RDB tables. */
  readScope: RdbReadScopeSchema.optional(),
  /** RDB page, query, source extent and consistency are separate claims. */
  coverage: RdbReadCoverageSchema.optional(),
  source: z.object({
    artifactId: z.string().optional(),
    filePath: z.string().optional(),
    workbookSheet: z.string().optional(),
    /** SHA-256 of the immutable input bytes used to issue source row keys. */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    headerRow: z.number().int().positive().optional(),
    database: z.string().optional(),
    schema: z.string().optional(),
    table: z.string().optional(),
    queryFingerprint: z.string().optional(),
    capturedAt: z.string().optional(),
  }).optional(),
  metadata: ArtifactMetadataSchema.optional(),
});

export type ScalarValue = z.infer<typeof ScalarValueSchema>;
export type TableColumnType = z.infer<typeof TableColumnTypeSchema>;
export type TableColumn = z.infer<typeof TableColumnSchema>;
export type TableRow = z.infer<typeof TableRowSchema>;
export type TableProfileField = z.infer<typeof TableProfileFieldSchema>;
export type TableProfile = z.infer<typeof TableProfileSchema>;
export type TableArtifact = z.infer<typeof TableArtifactSchema>;

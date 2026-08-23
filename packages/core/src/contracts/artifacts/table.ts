import { z } from 'zod';
import { ArtifactMetadataSchema } from './base.js';

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
});

export const TableRowSchema = z.object({
  index: z.number().int().nonnegative(),
  key: z.string().optional(),
  values: z.record(ScalarValueSchema),
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
  source: z.object({
    artifactId: z.string().optional(),
    filePath: z.string().optional(),
    workbookSheet: z.string().optional(),
    database: z.string().optional(),
    schema: z.string().optional(),
    table: z.string().optional(),
    queryFingerprint: z.string().optional(),
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

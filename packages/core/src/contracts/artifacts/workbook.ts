import { z } from 'zod';
import { ArtifactMetadataSchema } from './base.js';
import { FileRefSchema } from './file-ref.js';

export const WorkbookSheetSchema = z.object({
  name: z.string(),
  index: z.number().int().nonnegative(),
  visibility: z.enum(['visible', 'hidden', 'veryHidden']).default('visible'),
  usedRange: z.object({
    startRow: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endRow: z.number().int().positive(),
    endColumn: z.number().int().positive(),
  }).optional(),
  tables: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    range: z.string().optional(),
    artifactId: z.string(),
  })).default([]),
  formulaCount: z.number().int().nonnegative().default(0),
  imageCount: z.number().int().nonnegative().default(0),
  chartCount: z.number().int().nonnegative().default(0),
});

export const WorkbookArtifactSchema = z.object({
  id: z.string(),
  kind: z.literal('workbook'),
  file: FileRefSchema,
  sheets: z.array(WorkbookSheetSchema),
  namedRanges: z.array(z.object({
    name: z.string(),
    ref: z.string(),
  })).default([]),
  metadata: ArtifactMetadataSchema.optional(),
});

export type WorkbookSheet = z.infer<typeof WorkbookSheetSchema>;
export type WorkbookArtifact = z.infer<typeof WorkbookArtifactSchema>;

import { z } from 'zod';

const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const AxDocumentSummarySchema = z.object({
  pageCount: NonNegativeIntegerSchema,
  chunkCount: NonNegativeIntegerSchema,
  tableCount: NonNegativeIntegerSchema,
  imageCount: NonNegativeIntegerSchema,
  visualPageCount: NonNegativeIntegerSchema,
  visualPages: z.array(NonNegativeIntegerSchema),
  ocrPageCount: NonNegativeIntegerSchema.optional(),
  ocrPages: z.array(NonNegativeIntegerSchema).optional(),
  engine: z.string().min(1),
});

export const AxDocumentPageDetailSchema = z.object({
  index: NonNegativeIntegerSchema,
  text: z.string().nullable().optional(),
  hasVisual: z.boolean().optional(),
  sourceType: z.enum(['native', 'image', 'scan', 'mixed']).optional(),
  ocrApplied: z.boolean().optional(),
  imagePath: z.string().nullable().optional(),
  ocrConfidence: z.number().nullable().optional(),
});

export const AxDocumentImageRefSchema = z.object({
  id: z.string().min(1),
  pageIndex: NonNegativeIntegerSchema,
  path: z.string().nullable().optional().transform((value) => value ?? undefined),
  ocrText: z.string().nullable().optional().transform((value) => value ?? undefined),
  ocrConfidence: z.number().nullable().optional(),
});

export const AxDocumentTableRefSchema = z.object({
  id: z.string().min(1),
  pageIndex: NonNegativeIntegerSchema,
  text: z.string().nullable().optional().transform((value) => value ?? undefined),
});

export const IngestDocumentResultSchema = z.object({
  documentId: z.string().min(1),
  artifactPath: z.string().min(1),
  engine: z.string().min(1),
  summary: AxDocumentSummarySchema,
  text: z.string().optional(),
  pages: z.array(AxDocumentPageDetailSchema).optional(),
  images: z.array(AxDocumentImageRefSchema).optional(),
  tables: z.array(AxDocumentTableRefSchema).optional(),
  cached: z.boolean().optional(),
  fallbackFrom: z.string().min(1).optional(),
});

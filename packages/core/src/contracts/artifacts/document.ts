import { z } from 'zod';
import { FileRefSchema } from './file-ref.js';

export const DocumentPageSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().optional(),
  hasVisual: z.boolean().optional(),
});

export const DocumentArtifactSchema = z.object({
  id: z.string(),
  source: FileRefSchema.optional(),
  artifactPath: z.string().optional(),
  engine: z.string().optional(),
  pageCount: z.number().int().nonnegative().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  tableCount: z.number().int().nonnegative().optional(),
  imageCount: z.number().int().nonnegative().optional(),
  text: z.string().optional(),
  pages: z.array(DocumentPageSchema).default([]),
});

export type DocumentArtifact = z.infer<typeof DocumentArtifactSchema>;

export const DocumentIngestInputSchema = z.object({
  file: FileRefSchema.optional(),
  path: z.string().optional(),
});

export type DocumentIngestInput = z.infer<typeof DocumentIngestInputSchema>;

/** Resolve ingest path from explicit path or FileRef.path */
export function documentIngestPath(input: DocumentIngestInput): string | undefined {
  const path = input.path?.trim() || input.file?.path?.trim();
  return path || undefined;
}

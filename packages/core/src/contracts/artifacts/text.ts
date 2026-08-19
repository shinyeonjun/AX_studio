import { z } from 'zod';

export const TextArtifactSchema = z.object({
  text: z.string(),
  format: z.enum(['plain', 'markdown', 'html']).default('plain'),
  title: z.string().optional(),
});

export type TextArtifact = z.infer<typeof TextArtifactSchema>;

export const TableArtifactSchema = z.object({
  columns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.unknown())).default([]),
});

export type TableArtifact = z.infer<typeof TableArtifactSchema>;

export const JsonArtifactSchema = z.object({
  value: z.unknown(),
});

export type JsonArtifact = z.infer<typeof JsonArtifactSchema>;

import { z } from 'zod';

export const TextArtifactSchema = z.object({
  text: z.string(),
  format: z.enum(['plain', 'markdown', 'html']).default('plain'),
  title: z.string().optional(),
});

export type TextArtifact = z.infer<typeof TextArtifactSchema>;

export const JsonArtifactSchema = z.object({
  value: z.unknown(),
});

export type JsonArtifact = z.infer<typeof JsonArtifactSchema>;

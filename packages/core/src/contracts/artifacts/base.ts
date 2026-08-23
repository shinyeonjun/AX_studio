import { z } from 'zod';

export const ArtifactMetadataSchema = z.object({
  createdAt: z.string().optional(),
  mimeType: z.string().optional(),
  sha256: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

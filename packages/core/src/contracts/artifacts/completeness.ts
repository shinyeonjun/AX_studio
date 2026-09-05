import { z } from 'zod';

/** Why an artifact may not represent the complete upstream result. */
export const ArtifactCompletenessReasonSchema = z.enum([
  'row_limit',
  'response_byte_limit',
  'provider_limit',
  'unknown',
]);

export const ArtifactCompletenessStatusSchema = z.enum([
  'complete',
  'partial',
  'unknown',
]);

/**
 * Small, transport-neutral metadata shared by bounded data artifacts.
 * `complete` is deliberately explicit so consumers cannot infer completeness
 * from the number of rows they happened to receive.
 */
export const ArtifactCompletenessSchema = z.object({
  status: ArtifactCompletenessStatusSchema,
  reason: ArtifactCompletenessReasonSchema.optional(),
  observedCount: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  hasMore: z.boolean().optional(),
});

export type ArtifactCompletenessReason = z.infer<typeof ArtifactCompletenessReasonSchema>;
export type ArtifactCompletenessStatus = z.infer<typeof ArtifactCompletenessStatusSchema>;
export type ArtifactCompleteness = z.infer<typeof ArtifactCompletenessSchema>;

export function completeArtifactCompleteness(observedCount?: number): ArtifactCompleteness {
  return {
    status: 'complete',
    ...(observedCount === undefined ? {} : { observedCount }),
    hasMore: false,
  };
}

export function partialArtifactCompleteness(
  reason: ArtifactCompletenessReason,
  options: { observedCount?: number; limit?: number; hasMore?: boolean } = {},
): ArtifactCompleteness {
  return {
    status: 'partial',
    reason,
    ...(options.observedCount === undefined ? {} : { observedCount: options.observedCount }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.hasMore === undefined ? {} : { hasMore: options.hasMore }),
  };
}

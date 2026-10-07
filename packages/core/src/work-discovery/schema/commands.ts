import { z } from 'zod';

export const DiscoveryStartArgsSchema = z.object({
  goal: z.string().trim().min(1),
  exampleArtifactIds: z.array(z.string().trim().min(1)).min(1).max(3),
  inputArtifactIds: z.array(z.string().trim().min(1)).max(10).optional(),
  /**
   * Inputs that belong to one example only, in the order of exampleArtifactIds: August's export
   * for August's report. inputArtifactIds are still read for every example.
   */
  exampleInputArtifactIds: z.array(z.array(z.string().trim().min(1)).max(10)).max(3).optional(),
  desiredRecurrence: z.string().optional(),
}).refine((args) => !args.exampleInputArtifactIds || args.exampleInputArtifactIds.length === args.exampleArtifactIds.length, {
  message: 'exampleInputArtifactIds must have one entry per example',
  path: ['exampleInputArtifactIds'],
});

export const DiscoveryInspectArgsSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export const DiscoveryCancelArgsSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export const DiscoveryRetryArgsSchema = z.object({
  sessionId: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative(),
});

export type DiscoveryStartArgs = z.infer<typeof DiscoveryStartArgsSchema>;
export type DiscoveryInspectArgs = z.infer<typeof DiscoveryInspectArgsSchema>;
export type DiscoveryCancelArgs = z.infer<typeof DiscoveryCancelArgsSchema>;
export type DiscoveryRetryArgs = z.infer<typeof DiscoveryRetryArgsSchema>;

export const DiscoveryAnswerArgsSchema = z.object({
  sessionId: z.string().trim().min(1),
  questionId: z.string().trim().min(1),
  optionId: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export const DiscoveryPublishArgsSchema = z.object({
  sessionId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  /** The schedule form's answer (description + token); without it the work runs when asked. */
  schedule: z.string().trim().min(1).max(4_000).optional(),
});

export type DiscoveryAnswerArgs = z.infer<typeof DiscoveryAnswerArgsSchema>;
export type DiscoveryPublishArgs = z.infer<typeof DiscoveryPublishArgsSchema>;

import { z } from 'zod';

export const DiscoveryStatusSchema = z.enum([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
  'needs_attention',
  'needs_clarification',
  'ready_to_publish',
  'publishing',
  'published',
  'failed',
  'cancelled',
]);

export type DiscoveryStatus = z.infer<typeof DiscoveryStatusSchema>;

export const DiscoveryRecoveryCheckpointSchema = z.enum([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
]);

export type DiscoveryRecoveryCheckpoint = z.infer<typeof DiscoveryRecoveryCheckpointSchema>;

import { z } from 'zod';

export const ExecutionResultStatusSchema = z.enum([
  'success',
  'failed',
  'pending_approval',
  'cancelled',
]);

/**
 * Lifecycle states that can be delivered as a completed or resumable
 * execution result. `running` is intentionally storage-only.
 */
export type ExecutionResultStatus = z.infer<typeof ExecutionResultStatusSchema>;

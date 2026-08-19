import { z } from 'zod';

export const WorkflowRevisionSchema = z.object({
  proposal: z.string(),
  changes: z.array(z.string()),
});

export type WorkflowRevision = z.infer<typeof WorkflowRevisionSchema>;

import { z } from 'zod';

export const SkillRevisionSchema = z.object({
  proposal: z.string(),
  changes: z.array(z.string()),
});

export type SkillRevision = z.infer<typeof SkillRevisionSchema>;

import { z } from 'zod';

/** User-facing calculated results, stored separately from diagnostic/agent logs. */
export const ExecutionOutputSchema = z.object({
  version: z.literal(1),
  fields: z.array(z.object({
    path: z.string().min(1).max(512),
    label: z.string().max(512).optional(),
    valueJson: z.string().max(65_536).refine(value => {
      try { JSON.parse(value); return true; } catch { return false; }
    }),
  })).min(1).max(100),
});

export type ExecutionOutput = z.infer<typeof ExecutionOutputSchema>;

export function parseExecutionOutput(json: string | null | undefined): ExecutionOutput | undefined {
  if (!json || json.length > 262_144) return undefined;
  try {
    const parsed = ExecutionOutputSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

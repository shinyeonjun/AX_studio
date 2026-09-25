import { z } from 'zod';

export const InvestigationOutputSchema = z.object({
  reason: z.string().optional(),
  conclusion: z.string().optional(),
  evidence: z.array(z.object({ source: z.string(), detail: z.string() })).optional(),
  category: z.string().optional(),
  confidence: z.number().optional(),
});

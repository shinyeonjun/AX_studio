import { z } from 'zod';

export const InvestigationOutputSchema = z.object({
  needMore: z.boolean(),
  nextRead: z.string().optional(),
  nextReadParams: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  conclusion: z.string().optional(),
  evidence: z.array(z.object({ source: z.string(), detail: z.string() })).optional(),
  category: z.string().optional(),
  confidence: z.number().optional(),
});

import { z } from 'zod';

function parseJsonRecordValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

export const InvestigationOutputSchema = z.object({
  needMore: z.boolean(),
  nextRead: z.string().optional(),
  nextReadParams: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).optional()),
  reason: z.string().optional(),
  conclusion: z.string().optional(),
  evidence: z.array(z.object({ source: z.string(), detail: z.string() })).optional(),
  category: z.string().optional(),
  confidence: z.number().optional(),
});

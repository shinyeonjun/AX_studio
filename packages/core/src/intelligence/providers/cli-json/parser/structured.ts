import type { ZodType } from 'zod';
import { structuredOutputCandidates } from './candidates.js';
import { parseJsonObject } from './json-text.js';

export function parseStructuredOutput<T>(raw: string, schema: ZodType<T>): T {
  const parsed = parseJsonObject(raw);
  let lastError: unknown;
  for (const candidate of structuredOutputCandidates(parsed)) {
    const result = schema.safeParse(candidate);
    if (result.success) return result.data;
    lastError = result.error;
  }
  if (lastError instanceof Error) throw lastError;
  return schema.parse(parsed);
}

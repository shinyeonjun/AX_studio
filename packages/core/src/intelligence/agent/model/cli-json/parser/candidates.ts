import { parseJsonObject } from './json-text.js';

export function structuredOutputCandidates(parsed: unknown): unknown[] {
  const candidates: unknown[] = [];
  const seen = new Set<unknown>();
  const push = (value: unknown) => {
    if (value == null || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  push(parsed);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const key of ['structured_output', 'result', 'data', 'output'] as const) {
      const nested = record[key];
      if (nested && typeof nested === 'object') push(nested);
      if (typeof nested === 'string') {
        try {
          push(parseJsonObject(nested));
        } catch {
          /* ignore non-json */
        }
      }
    }
  }
  return candidates;
}

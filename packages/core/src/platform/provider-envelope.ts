import { z } from 'zod';
import { parseJsonObject } from '../agent/model/cli-json.js';

/** Shared CLI wire envelope: discriminated unions flattened for Codex/Claude CLI JSON schema. */
export const AgentWireEnvelopeSchema = z.object({
  kind: z.enum(['tools', 'reply', 'patch']),
  message: z.string().default(''),
  toolCalls: z.string().default(''),
  patch: z.string().default(''),
});

export type AgentWireEnvelope = z.infer<typeof AgentWireEnvelopeSchema>;

export function parseToolCallsJsonPayload<S extends z.ZodTypeAny>(
  raw: unknown,
  itemSchema: S,
): z.infer<S>[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    return z.array(itemSchema).parse(raw);
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? z.array(itemSchema).parse(parsed) : undefined;
  } catch {
    try {
      const parsed = parseJsonObject(trimmed);
      return Array.isArray(parsed) ? z.array(itemSchema).parse(parsed) : undefined;
    } catch {
      return undefined;
    }
  }
}

export function usesCliWireEnvelope(providerName: string): boolean {
  return providerName === 'codex-cli' || providerName === 'claude-cli';
}

import { z } from 'zod';
import { DESIGN_TOOL_IDS } from '../design-tools/types.js';
import { InterviewDraftSchema, InterviewTurnSchema } from './workflow-schema.js';

export const DesignToolCallSchema = z.object({
  tool: z.enum(DESIGN_TOOL_IDS),
  args: z.record(z.unknown()).optional(),
});

export const InterviewDiscoverOutputSchema = z.object({
  kind: z.literal('discover'),
  toolCalls: z.array(DesignToolCallSchema).min(1).max(5),
});

export const InterviewDesignOutputSchema = InterviewTurnSchema.extend({
  kind: z.literal('design'),
});

export const InterviewAgentOutputInnerSchema = z.discriminatedUnion('kind', [
  InterviewDiscoverOutputSchema,
  InterviewDesignOutputSchema,
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function looksLikeAgentPayload(record: Record<string, unknown>): boolean {
  return (
    typeof record.kind === 'string' ||
    Array.isArray(record.toolCalls) ||
    typeof record.nextQuestion === 'string' ||
    typeof record.name === 'string' ||
    typeof record.goal === 'string' ||
    Array.isArray(record.nodes) ||
    typeof record.triggerType === 'string'
  );
}

function parseEmbeddedJson(raw: string): unknown | null {
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fenced ? fenced[1].trim() : trimmed;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return null;
  }
}

/** Pull interview JSON out of Claude CLI envelopes (`type=result`, structured_output, result). */
export function unwrapInterviewPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  const record = asRecord(value);
  if (!record) return value;

  const nested = [record.structured_output, record.result, record.data, record.output];
  for (const candidate of nested) {
    if (typeof candidate === 'string') {
      const parsed = parseEmbeddedJson(candidate);
      if (parsed) return unwrapInterviewPayload(parsed, depth + 1);
    }
    const inner = asRecord(candidate);
    if (inner && looksLikeAgentPayload(inner)) {
      return unwrapInterviewPayload(inner, depth + 1);
    }
  }

  return value;
}

/** Coerce legacy CLI output (no/invalid kind) and partial discover payloads. */
export function normalizeInterviewAgentOutput(value: unknown): unknown {
  const unwrapped = unwrapInterviewPayload(value);
  const record = asRecord(unwrapped);
  if (!record) return unwrapped;

  const rawKind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : undefined;
  const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
  const hasDesignFields =
    typeof record.nextQuestion === 'string' ||
    typeof record.name === 'string' ||
    typeof record.goal === 'string' ||
    Array.isArray(record.nodes);

  if (rawKind === 'discover' || (hasToolCalls && rawKind !== 'design' && !record.nextQuestion)) {
    return { ...record, toolCalls, kind: 'discover' };
  }
  if (rawKind === 'design' || hasDesignFields) {
    return { ...record, kind: 'design' };
  }
  return unwrapped;
}

/**
 * Flat object the model/CLI actually emits.
 * Discriminated unions become `oneOf` in json-schema, which Claude CLI often ignores.
 */
export const InterviewAgentModelSchema = z.preprocess(
  normalizeInterviewAgentOutput,
  InterviewDraftSchema.partial().extend({
    kind: z.enum(['discover', 'design']),
    toolCalls: z.array(DesignToolCallSchema).optional(),
    nextQuestion: z.string().optional(),
  }),
);

export type DesignToolCallInput = z.infer<typeof DesignToolCallSchema>;
export type InterviewDiscoverOutput = z.infer<typeof InterviewDiscoverOutputSchema>;
export type InterviewDesignOutput = z.infer<typeof InterviewDesignOutputSchema>;
export type InterviewAgentOutput = z.infer<typeof InterviewAgentOutputInnerSchema>;

export function parseInterviewAgentOutput(value: unknown): InterviewAgentOutput {
  const normalized = normalizeInterviewAgentOutput(value);
  return InterviewAgentOutputInnerSchema.parse(normalized);
}

/** Strip agent envelope before workflow compile. */
export function interviewTurnFromAgentOutput(output: InterviewDesignOutput) {
  const { kind: _kind, ...turn } = output;
  return InterviewTurnSchema.parse(turn);
}

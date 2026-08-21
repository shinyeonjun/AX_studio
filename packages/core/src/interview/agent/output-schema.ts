import { z } from 'zod';
import { InterviewPatchSchema, type InterviewPatch } from '../slots/patch.js';
import { WorkflowPlanSchema, type WorkflowPlan } from '../plan/schema.js';
import {
  DesignToolCallSchema,
  MAX_INTERVIEW_DISCOVER_TOOL_CALLS,
  normalizeProviderInterviewOutput,
} from './wire-schema.js';

export { DesignToolCallSchema, MAX_INTERVIEW_DISCOVER_TOOL_CALLS } from './wire-schema.js';

export const InterviewDiscoverOutputSchema = z.object({
  kind: z.literal('discover'),
  toolCalls: z.array(DesignToolCallSchema).min(1).max(MAX_INTERVIEW_DISCOVER_TOOL_CALLS),
});

export const InterviewPatchOutputSchema = z.object({
  kind: z.literal('patch'),
  patch: InterviewPatchSchema,
  nextQuestion: z.string(),
});

export const InterviewPlanOutputSchema = z.object({
  kind: z.literal('plan'),
  plan: WorkflowPlanSchema,
  nextQuestion: z.string(),
});

export const InterviewReplanOutputSchema = z.object({
  kind: z.literal('replan'),
  plan: WorkflowPlanSchema,
  nextQuestion: z.string(),
});

export const InterviewAgentOutputInnerSchema = z.discriminatedUnion('kind', [
  InterviewDiscoverOutputSchema,
  InterviewPatchOutputSchema,
  InterviewPlanOutputSchema,
  InterviewReplanOutputSchema,
]);

export type DesignToolCallInput = z.infer<typeof DesignToolCallSchema>;
export type InterviewDiscoverOutput = z.infer<typeof InterviewDiscoverOutputSchema>;
export type InterviewPatchOutput = z.infer<typeof InterviewPatchOutputSchema>;
export type InterviewPlanOutput = z.infer<typeof InterviewPlanOutputSchema>;
export type InterviewReplanOutput = z.infer<typeof InterviewReplanOutputSchema>;

export type InterviewAgentResult = InterviewPatchOutput | InterviewPlanOutput | InterviewReplanOutput;

export type InterviewAgentOutput = z.infer<typeof InterviewAgentOutputInnerSchema>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function looksLikeAgentPayload(record: Record<string, unknown>): boolean {
  return (
    typeof record.kind === 'string' ||
    Array.isArray(record.toolCalls) ||
    typeof record.nextQuestion === 'string' ||
    typeof record.payload === 'string' ||
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

function trimDiscoverToolCalls(toolCalls: unknown[] | undefined): unknown[] | undefined {
  if (!toolCalls?.length || toolCalls.length <= MAX_INTERVIEW_DISCOVER_TOOL_CALLS) {
    return toolCalls;
  }
  return toolCalls.slice(0, MAX_INTERVIEW_DISCOVER_TOOL_CALLS);
}

/** Coerce legacy CLI output (no/invalid kind) and partial discover payloads. */
export function normalizeInterviewAgentOutput(value: unknown): unknown {
  const unwrapped = unwrapInterviewPayload(value);
  const record = asRecord(unwrapped);
  if (!record) return unwrapped;

  const rawKind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  const toolCalls = trimDiscoverToolCalls(Array.isArray(record.toolCalls) ? record.toolCalls : undefined);
  const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
  const hasPlanFields =
    typeof record.nextQuestion === 'string' ||
    typeof record.name === 'string' ||
    typeof record.goal === 'string' ||
    Array.isArray(record.nodes) ||
    typeof record.triggerType === 'string';

  if (rawKind === 'patch' && record.patch) {
    return {
      kind: 'patch',
      patch: record.patch,
      nextQuestion: record.nextQuestion ?? '',
    };
  }

  if ((rawKind === 'plan' || rawKind === 'replan') && record.plan) {
    return {
      kind: rawKind,
      plan: record.plan,
      nextQuestion: record.nextQuestion ?? '',
    };
  }

  if (hasToolCalls && (rawKind === 'discover' || (rawKind !== 'plan' && rawKind !== 'patch' && !record.nextQuestion))) {
    return { ...record, toolCalls, kind: 'discover' };
  }
  if (rawKind === 'discover' && !hasToolCalls) {
    if (hasPlanFields) {
      const { kind: _kind, toolCalls: _toolCalls, ...rest } = record;
      return { kind: 'plan', plan: WorkflowPlanSchema.parse(rest), nextQuestion: record.nextQuestion ?? '' };
    }
    return { ...record, kind: 'discover', toolCalls: toolCalls ?? [] };
  }
  if (rawKind === 'plan' || rawKind === 'replan' || rawKind === 'design' || hasPlanFields) {
    const { kind: _kind, toolCalls: _toolCalls, nextQuestion, ...rest } = record;
    return {
      kind: rawKind === 'replan' ? 'replan' : 'plan',
      plan: WorkflowPlanSchema.parse(rest),
      nextQuestion: typeof nextQuestion === 'string' ? nextQuestion : '',
    };
  }
  return unwrapped;
}

export function parseInterviewAgentOutput(value: unknown): InterviewAgentOutput {
  const normalized = normalizeInterviewAgentOutput(value);
  return InterviewAgentOutputInnerSchema.parse(normalized);
}

export function parseInterviewProviderOutput(
  providerName: string,
  value: unknown,
): InterviewAgentOutput {
  const unwrapped = unwrapInterviewPayload(value);
  const normalized = normalizeProviderInterviewOutput(providerName, unwrapped);
  const coerced = normalizeInterviewAgentOutput(normalized);
  return InterviewAgentOutputInnerSchema.parse(coerced);
}

export function isInterviewTerminalResult(
  output: InterviewAgentOutput,
): output is InterviewAgentResult {
  return output.kind === 'patch' || output.kind === 'plan' || output.kind === 'replan';
}

export function interviewResultFromOutput(output: InterviewAgentOutput): InterviewAgentResult {
  if (output.kind === 'patch' || output.kind === 'plan' || output.kind === 'replan') {
    return output;
  }
  throw new Error('Expected patch or plan interview output');
}

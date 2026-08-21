import { z } from 'zod';
import { DESIGN_TOOL_IDS } from '../../design-tools/types.js';
import { parseJsonObject } from '../../agent/model/cli-json.js';
import { parseJsonRecordValue } from '../draft/schema.js';
import { InterviewPatchSchema } from '../slots/patch.js';
import { WorkflowPlanSchema } from '../plan/schema.js';

export const DesignToolCallSchema = z.object({
  tool: z.enum(DESIGN_TOOL_IDS),
  args: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).optional()),
});

export const MAX_INTERVIEW_DISCOVER_TOOL_CALLS = 5;

function parseEmbeddedPayload(raw: unknown): unknown {
  if (raw == null) return undefined;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return parseJsonObject(trimmed);
  } catch {
    return undefined;
  }
}

function parseToolCallsPayload(raw: unknown): unknown[] | undefined {
  const parsed = parseEmbeddedPayload(raw);
  return Array.isArray(parsed) ? parsed : undefined;
}

/** Codex `--output-schema` wire envelope: flat required keys, nested data in JSON strings. */
export const InterviewWireEnvelopeSchema = z.object({
  kind: z.enum(['discover', 'patch', 'plan', 'replan', 'design']),
  payload: z.string().default(''),
  toolCalls: z.string().default(''),
  nextQuestion: z.string().default(''),
});

export type InterviewWireEnvelope = z.infer<typeof InterviewWireEnvelopeSchema>;

export function expandInterviewWireEnvelope(envelope: InterviewWireEnvelope): unknown {
  const nextQuestion = envelope.nextQuestion.trim();
  const kind = envelope.kind === 'design' ? 'plan' : envelope.kind;

  if (kind === 'discover') {
    const toolCalls = parseToolCallsPayload(envelope.toolCalls) ?? parseToolCallsPayload(envelope.payload);
    return {
      kind: 'discover',
      toolCalls: toolCalls ?? [],
      ...(nextQuestion ? { nextQuestion } : {}),
    };
  }

  const payload = parseEmbeddedPayload(envelope.payload) ?? {};
  const payloadRecord =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  if (kind === 'patch') {
    const patch = InterviewPatchSchema.parse(
      payloadRecord.set ? payloadRecord : { set: payloadRecord },
    );
    return { kind: 'patch', patch, nextQuestion };
  }

  const plan = WorkflowPlanSchema.parse(payloadRecord);
  return { kind, plan, nextQuestion };
}

export function interviewOutputSchemaForProvider(providerName: string): z.ZodType {
  return providerName === 'codex-cli' ? InterviewWireEnvelopeSchema : InterviewNativeEnvelopeSchema;
}

/** Native providers may emit structured objects directly (Claude, scripted tests). */
export const InterviewNativeEnvelopeSchema = z.preprocess(
  normalizeNativeInterviewEnvelope,
  z.object({
    kind: z.enum(['discover', 'patch', 'plan', 'replan', 'design']),
    toolCalls: z.array(DesignToolCallSchema).optional(),
    payload: z.unknown().optional(),
    patch: InterviewPatchSchema.optional(),
    plan: WorkflowPlanSchema.optional(),
    nextQuestion: z.string().optional(),
    name: z.string().optional(),
    goal: z.string().optional(),
    triggerType: z.string().optional(),
    nodes: z.array(z.record(z.unknown())).optional(),
  }).passthrough(),
);

function normalizeNativeInterviewEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const rawKind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';

  if (rawKind === 'discover') {
    return record;
  }

  if (rawKind === 'patch') {
    const patch =
      record.patch ??
      (record.payload && typeof record.payload === 'object'
        ? InterviewPatchSchema.parse(record.payload)
        : InterviewPatchSchema.parse({ set: record.set ?? {} }));
    return {
      kind: 'patch',
      patch,
      nextQuestion: record.nextQuestion ?? '',
    };
  }

  if (rawKind === 'plan' || rawKind === 'replan') {
    const plan =
      record.plan ??
      WorkflowPlanSchema.parse(
        record.payload && typeof record.payload === 'object' ? record.payload : record,
      );
    return { kind: rawKind, plan, nextQuestion: record.nextQuestion ?? '' };
  }

  if (rawKind === 'design' || record.nodes || record.triggerType) {
    const { kind: _kind, toolCalls: _toolCalls, nextQuestion, ...rest } = record;
    return {
      kind: 'plan',
      plan: WorkflowPlanSchema.parse(rest),
      nextQuestion: typeof nextQuestion === 'string' ? nextQuestion : '',
    };
  }

  return value;
}

function isExpandedInterviewOutput(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'patch' && record.patch) return true;
  if ((record.kind === 'plan' || record.kind === 'replan') && record.plan) return true;
  if (record.kind === 'discover' && Array.isArray(record.toolCalls)) return true;
  return false;
}

export function normalizeProviderInterviewOutput(
  providerName: string,
  value: unknown,
): unknown {
  if (isExpandedInterviewOutput(value)) return value;
  if (providerName === 'codex-cli') {
    const envelope = InterviewWireEnvelopeSchema.parse(value);
    return expandInterviewWireEnvelope(envelope);
  }
  return normalizeNativeInterviewEnvelope(value);
}

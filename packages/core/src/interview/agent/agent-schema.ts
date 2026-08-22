import { z } from 'zod';
import { parseJsonObject } from '../../agent/model/cli-json.js';
import { DesignToolCallSchema, MAX_DESIGN_TOOL_CALLS_PER_TURN } from '../../design-tools/types.js';
import {
  WorkflowDraftPatchSchema,
  parseWorkflowDraftPatch,
} from './draft-patch.js';

export const AgenticInterviewToolsSchema = z.object({
  kind: z.literal('tools'),
  toolCalls: z.array(DesignToolCallSchema).min(1).max(MAX_DESIGN_TOOL_CALLS_PER_TURN),
});

export const AgenticInterviewPatchSchema = z.object({
  kind: z.literal('patch'),
  patch: WorkflowDraftPatchSchema,
  message: z.string().max(2_000).default(''),
});

export const AgenticInterviewReplySchema = z.object({
  kind: z.literal('reply'),
  message: z.string().min(1).max(4_000),
});

const AgenticInterviewOutputUnionSchema = z.discriminatedUnion('kind', [
  AgenticInterviewToolsSchema,
  AgenticInterviewPatchSchema,
  AgenticInterviewReplySchema,
]);

export type AgenticInterviewOutput = z.infer<typeof AgenticInterviewOutputUnionSchema>;
export type AgenticInterviewPatchOutput = z.infer<typeof AgenticInterviewPatchSchema>;

function parseEmbedded(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    return JSON.parse(value.trim());
  } catch {
    // CLI output may contain a fenced/object wrapper; retain the shared
    // extractor as a fallback for that representation.
  }
  try {
    return parseJsonObject(value.trim());
  } catch {
    return value;
  }
}

/** Structured-output wire contract for Codex and Claude CLI object-only schemas. */
export const AgenticInterviewWireEnvelopeSchema = z.object({
  kind: z.enum(['tools', 'patch', 'reply']),
  payload: z.string().default(''),
  toolCalls: z.string().default(''),
  message: z.string().default(''),
});

export type AgenticInterviewWireEnvelope = z.infer<typeof AgenticInterviewWireEnvelopeSchema>;

export function agenticInterviewOutputSchemaForProvider(providerName: string): z.ZodType {
  return providerName === 'codex-cli' || providerName === 'claude-cli'
    ? AgenticInterviewWireEnvelopeSchema
    : AgenticInterviewOutputUnionSchema;
}

function parseToolCalls(raw: unknown) {
  const value = parseEmbedded(raw);
  return z.array(DesignToolCallSchema).parse(value);
}

export function expandAgenticInterviewWireEnvelope(
  envelope: AgenticInterviewWireEnvelope,
): AgenticInterviewOutput {
  if (envelope.kind === 'reply') {
    return AgenticInterviewReplySchema.parse({ kind: 'reply', message: envelope.message });
  }
  if (envelope.kind === 'tools') {
    return AgenticInterviewToolsSchema.parse({ kind: 'tools', toolCalls: parseToolCalls(envelope.toolCalls) });
  }
  return AgenticInterviewPatchSchema.parse({
    kind: 'patch',
    patch: parseWorkflowDraftPatch(parseEmbedded(envelope.payload)),
    message: envelope.message,
  });
}

export function parseAgenticInterviewOutput(
  providerName: string,
  value: unknown,
): AgenticInterviewOutput {
  if (providerName === 'codex-cli' || providerName === 'claude-cli') {
    return expandAgenticInterviewWireEnvelope(AgenticInterviewWireEnvelopeSchema.parse(value));
  }
  return AgenticInterviewOutputUnionSchema.parse(value);
}

export function withCurrentPatchRevision(
  output: AgenticInterviewPatchOutput,
  revision: number,
): AgenticInterviewPatchOutput {
  return {
    ...output,
    patch: {
      ...output.patch,
      baseRevision: output.patch.baseRevision ?? revision,
    },
  };
}

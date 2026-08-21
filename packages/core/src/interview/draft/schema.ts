import { z } from 'zod';
import { ConditionExprSchema, normalizeCondition } from '../../runtime/condition-expr.js';
import { PortBindingSchema } from '../../workflow/bindings.js';

export function parseJsonRecordValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/** CLI models often stringify bindings records like params/condition. */
export function parseBindingsRecord(value: unknown): unknown {
  if (value == null || value === '') return undefined;

  const parsed = parseJsonRecordValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Preserve malformed input so the schema rejects it. Dropping a bad
    // binding would silently change the execution graph.
    return parsed;
  }

  const record = parsed as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [port, binding] of Object.entries(record)) {
    if (typeof binding === 'string') {
      const inner = parseJsonRecordValue(binding);
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        normalized[port] = inner;
      } else {
        return parsed;
      }
      continue;
    }
    if (binding && typeof binding === 'object' && !Array.isArray(binding)) {
      normalized[port] = binding;
      continue;
    }
    return parsed;
  }
  return normalized;
}

export const ActionInstanceSchema = z.object({
  actionRef: z.string(),
  connector: z.string().optional(),
  action: z.string().optional(),
  params: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).default({})),
  bindings: z.preprocess(parseBindingsRecord, z.record(PortBindingSchema).optional()),
});

export const WorkflowNodeSchema = z.object({
  type: z.enum(['action', 'ai_decision', 'if', 'human_approval']),
  id: z.string(),
  connector: z.string().optional(),
  action: z.string().optional(),
  actionRef: z.string().optional(),
  params: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).optional()),
  bindings: z.preprocess(parseBindingsRecord, z.record(PortBindingSchema).optional()),
  goal: z.string().optional(),
  /** Judgment criteria for ai_decision; passed to runtime investigate agent. */
  memo: z.string().optional(),
  outputFields: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'array']),
        description: z.string(),
        enumValues: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  investigation: z.boolean().optional(),
  condition: z.preprocess(
    (value) => {
      const parsed = parseJsonRecordValue(value);
      return parsed == null ? undefined : normalizeCondition(parsed);
    },
    ConditionExprSchema.optional(),
  ),
  thenStepIds: z.array(z.string()).optional(),
  elseStepIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
  forActionIds: z.array(z.string()).optional(),
});

export const InterviewDraftSchema = z.object({
  name: z.string(),
  goal: z.string(),
  triggerType: z
    .enum([
    'manual',
    'schedule',
    'once',
    'gmail.new_message',
    'slack.new_message',
    'local_folder.new_file',
    ])
    .optional(),
  triggerFilter: z.preprocess(
    (value) => {
      const parsed = parseJsonRecordValue(value);
      return parsed == null ? undefined : normalizeCondition(parsed);
    },
    ConditionExprSchema.optional(),
  ),
  schedule: z.string().optional(),
  timezone: z.string().optional(),
  runAt: z.string().optional(),
  gmailAccount: z.string().optional(),
  slackChannel: z.string().optional(),
  localFolderId: z.string().optional(),
  localFolderPath: z.string().optional(),
  localFolderExtensions: z.string().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  /** Graph structure: trigger metadata + nodes. Action params live in `actions`. */
  nodes: z.array(WorkflowNodeSchema).default([]),
  /** Per-action instance data keyed by node id (`slack.message.send@1`, params, bindings). */
  actions: z.record(ActionInstanceSchema).default({}),
});

export const InterviewTurnSchema = InterviewDraftSchema.extend({
  nextQuestion: z.string(),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type ActionInstance = z.infer<typeof ActionInstanceSchema>;
export type InterviewDraft = z.infer<typeof InterviewDraftSchema>;
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;

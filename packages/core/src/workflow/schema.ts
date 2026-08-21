import { z } from 'zod';
import { ConditionExprSchema, normalizeCondition } from '../runtime/condition-expr.js';
import { PortBindingSchema } from './bindings.js';
import { actionRefFor } from './action-definition.js';

export const SideEffectLevelSchema = z.enum([
  'NONE',
  'REVERSIBLE',
  'EXTERNAL',
  'EXTERNAL_HIGH',
]);

export const StepTypeSchema = z.enum([
  'action',
  'ai_decision',
  'if',
  'human_approval',
]);

export const TriggerFilterSchema = ConditionExprSchema;

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manual'),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('schedule'),
    schedule: z.string(),
    timezone: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('gmail.new_message'),
    accountId: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('slack.new_message'),
    channel: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('local_folder.new_file'),
    folderId: z.string(),
    folderPath: z.string().optional(),
    extensions: z.array(z.string()).optional(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('once'),
    runAt: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
]);

export const ActionStepSchema = z.object({
  type: z.literal('action'),
  id: z.string(),
  connector: z.string(),
  action: z.string(),
  actionRef: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  bindings: z.record(PortBindingSchema).optional(),
  sideEffect: SideEffectLevelSchema,
});

export const AiDecisionStepSchema = z.object({
  type: z.literal('ai_decision'),
  id: z.string(),
  goal: z.string(),
  memo: z.string().optional(),
  outputSchema: z.record(z.unknown()).optional(),
  investigation: z.boolean().default(false),
  maxReads: z.number().int().min(1).max(4).default(4),
  bindings: z.record(PortBindingSchema).optional(),
});

export const IfStepSchema = z.object({
  type: z.literal('if'),
  id: z.string(),
  condition: z.union([ConditionExprSchema, z.string()]).transform(normalizeCondition),
  thenStepIds: z.array(z.string()),
  elseStepIds: z.array(z.string()).optional(),
});

export const HumanApprovalStepSchema = z.object({
  type: z.literal('human_approval'),
  id: z.string(),
  reason: z.string(),
  forActionIds: z.array(z.string()),
});

export const StepSchema = z.discriminatedUnion('type', [
  ActionStepSchema,
  AiDecisionStepSchema,
  IfStepSchema,
  HumanApprovalStepSchema,
]);

export const DataPolicySchema = z.record(
  z.object({
    cloudAllowed: z.boolean().default(false),
  }),
);

export const WorkflowIRSchema = z.object({
  id: z.string().optional(),
  version: z.number().int().min(1).default(1),
  name: z.string(),
  goal: z.string(),
  trigger: TriggerSchema.optional(),
  inputs: z.array(z.string()).default([]),
  steps: z.array(StepSchema),
  permissions: z.record(z.boolean()).default({}),
  approval: z.array(z.string()).default([]),
  allowExternalAuto: z.boolean().default(true),
  fallback: z.string().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  sideEffects: z.record(SideEffectLevelSchema).default({}),
  dataPolicy: DataPolicySchema.default({}),
  /** Human-readable work contract (SKILL.md). Runtime executes `steps`, not this text. */
  document: z.string().optional(),
});

export type SideEffectLevel = z.infer<typeof SideEffectLevelSchema>;
export type Step = z.infer<typeof StepSchema>;
export type WorkflowIR = z.infer<typeof WorkflowIRSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;

export function parseWorkflowIR(data: unknown): WorkflowIR {
  const parsed = WorkflowIRSchema.parse(data);
  return {
    ...parsed,
    steps: parsed.steps.map((step) =>
      step.type === 'action'
        ? { ...step, actionRef: step.actionRef ?? actionRefFor(step.connector, step.action) }
        : step,
    ),
  };
}

export function validateWorkflowIR(data: unknown): { ok: true; value: WorkflowIR } | { ok: false; error: string } {
  const result = WorkflowIRSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}

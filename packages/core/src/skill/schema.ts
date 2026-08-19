import { z } from 'zod';

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

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manual'),
  }),
  z.object({
    type: z.literal('schedule'),
    schedule: z.string(),
    timezone: z.string().default('Asia/Seoul'),
  }),
  z.object({
    type: z.literal('gmail.new_message'),
    accountId: z.string(),
  }),
]);

export const ActionStepSchema = z.object({
  type: z.literal('action'),
  id: z.string(),
  connector: z.string(),
  action: z.string(),
  params: z.record(z.unknown()).default({}),
  sideEffect: SideEffectLevelSchema,
});

export const AiDecisionStepSchema = z.object({
  type: z.literal('ai_decision'),
  id: z.string(),
  goal: z.string(),
  outputSchema: z.record(z.unknown()).optional(),
  investigation: z.boolean().default(false),
  maxReads: z.number().int().min(1).max(4).default(4),
});

export const IfStepSchema = z.object({
  type: z.literal('if'),
  id: z.string(),
  condition: z.string(),
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

export const SkillIRSchema = z.object({
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
});

export type SideEffectLevel = z.infer<typeof SideEffectLevelSchema>;
export type Step = z.infer<typeof StepSchema>;
export type SkillIR = z.infer<typeof SkillIRSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;

export function parseSkillIR(data: unknown): SkillIR {
  return SkillIRSchema.parse(data);
}

export function validateSkillIR(data: unknown): { ok: true; value: SkillIR } | { ok: false; error: string } {
  const result = SkillIRSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}

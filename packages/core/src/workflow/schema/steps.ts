import { z } from 'zod';
import { ContractTypeNameSchema } from '../../contracts/capability-io.js';
import { ConditionExprSchema, normalizeCondition } from '../../runtime/condition-expr.js';
import { PortBindingSchema } from '../port-binding.js';
import { MAX_WORKFLOW_STEPS } from './limits.js';

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
  /** Declared input ports and their contract types for explicit AI context binding. */
  inputContracts: z.record(ContractTypeNameSchema).optional(),
  bindings: z.record(PortBindingSchema).optional(),
});

export const IfStepSchema = z.object({
  type: z.literal('if'),
  id: z.string(),
  condition: z.union([ConditionExprSchema, z.string()]).transform(normalizeCondition),
  thenStepIds: z.array(z.string()).max(MAX_WORKFLOW_STEPS),
  elseStepIds: z.array(z.string()).max(MAX_WORKFLOW_STEPS).optional(),
});

export const HumanApprovalStepSchema = z.object({
  type: z.literal('human_approval'),
  id: z.string(),
  reason: z.string(),
  forActionIds: z.array(z.string()).max(MAX_WORKFLOW_STEPS),
});

export const StepSchema = z.discriminatedUnion('type', [
  ActionStepSchema,
  AiDecisionStepSchema,
  IfStepSchema,
  HumanApprovalStepSchema,
]);

export type SideEffectLevel = z.infer<typeof SideEffectLevelSchema>;
export type Step = z.infer<typeof StepSchema>;

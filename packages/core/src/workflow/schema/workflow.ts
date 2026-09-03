import { z } from 'zod';
import { OutputContractSchema } from '../../contracts/output-contract.js';
import { MAX_WORKFLOW_STEPS } from './limits.js';
import { SideEffectLevelSchema, StepSchema } from './steps.js';
import { TriggerSchema } from './triggers.js';

export const DataPolicySchema = z.record(
  z.object({
    cloudAllowed: z.boolean().default(true),
  }),
);

export const WorkflowIRSchema = z.object({
  id: z.string().optional(),
  version: z.number().int().min(1).default(1),
  name: z.string(),
  goal: z.string(),
  trigger: TriggerSchema.optional(),
  inputs: z.array(z.string()).max(MAX_WORKFLOW_STEPS).default([]),
  steps: z.array(StepSchema).max(MAX_WORKFLOW_STEPS),
  permissions: z.record(z.boolean()).default({}),
  approval: z.array(z.string()).default([]),
  allowExternalAuto: z.boolean().default(false),
  fallback: z.string().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).max(MAX_WORKFLOW_STEPS).default([]),
  sideEffects: z.record(SideEffectLevelSchema).default({}),
  dataPolicy: DataPolicySchema.default({}),
  /** Historical output/input quality contract used by the runtime gate. */
  outputContract: OutputContractSchema.optional(),
  /** Human-readable work contract (SKILL.md). Runtime executes `steps`, not this text. */
  document: z.string().optional(),
});

export type WorkflowIR = z.infer<typeof WorkflowIRSchema>;

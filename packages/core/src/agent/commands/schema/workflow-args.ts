import { z } from 'zod';
import {
  AiDecisionStepSchema,
  HumanApprovalStepSchema,
  IfStepSchema,
  TriggerSchema,
} from '../../../workflow/schema.js';
import { PortBindingSchema } from '../../../workflow/port-binding.js';
import { AgentScopedContextUpdateArgsSchema } from '../../scoped-context.js';
import { AxUiPresentationSchema } from './interaction.js';

export const AxSourceListArgsSchema = z.object({
  connector: z.string().trim().min(1).optional(),
});

export const AxSourceFilesListArgsSchema = z.object({
  folderId: z.string().trim().min(1),
  extensions: z.union([z.array(z.string().trim().min(1)), z.string().trim().min(1)]).optional(),
});

export const AxSourceFileReadArgsSchema = z.object({
  folderId: z.string().trim().min(1),
  path: z.string().trim().min(1),
  maxChars: z.number().int().min(1_000).max(20_000).optional(),
});

export const AxSourceSearchArgsSchema = z.object({
  query: z.string().trim().min(1),
  folderId: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

export const AxSessionSourceListArgsSchema = z.object({});

export const AxSessionSourceReadArgsSchema = z.object({
  sourceId: z.string().trim().min(1),
  maxChars: z.number().int().min(1_000).max(20_000).optional(),
});

export const AxCapabilityInvokeArgsSchema = z.object({
  id: z.string().trim().min(1),
  params: z.record(z.unknown()).default({}),
});

export const AxWorkflowActionStepInputSchema = z.object({
  type: z.literal('action'),
  id: z.string().min(1),
  connector: z.string().min(1),
  action: z.string().min(1),
  actionRef: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  bindings: z.record(PortBindingSchema).optional(),
});

export const AxWorkflowStepInputSchema = z.union([
  AxWorkflowActionStepInputSchema,
  AiDecisionStepSchema,
  IfStepSchema,
  HumanApprovalStepSchema,
]);

export const AxWorkflowCreateArgsSchema = z.object({
  name: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  trigger: TriggerSchema.optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).max(200).default([]),
  steps: z.array(AxWorkflowStepInputSchema).max(200).default([]),
});

export const AxWorkflowUpdateOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set'),
    path: z.enum(['name', 'goal', 'trigger', 'success', 'assumptions']),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal('upsert_step'),
    step: AxWorkflowStepInputSchema,
  }),
  z.object({
    op: z.literal('remove_step'),
    stepId: z.string().min(1),
  }),
]);

export const AxWorkflowUpdateArgsSchema = z.object({
  workflowId: z.string().min(1),
  baseVersion: z.number().int().min(1),
  operations: z.array(AxWorkflowUpdateOperationSchema).min(1).max(50),
});

export const AxWorkflowDeleteArgsSchema = z.object({
  workflowId: z.string().min(1),
  baseVersion: z.number().int().min(1),
});

export const AxWorkflowRunArgsSchema = z.object({
  workflowId: z.string().trim().min(1),
});

/** One-shot execution uses the same plan shape as workflow.create, but is never persisted. */
export const AxExecutionEnqueueOnceArgsSchema = AxWorkflowCreateArgsSchema;

export const AxExecutionExplainArgsSchema = z.object({
  executionId: z.string().trim().min(1),
});

export const AxRepairListArgsSchema = z.object({
  workflowId: z.string().trim().min(1).optional(),
  status: z.enum(['proposed', 'applied', 'rejected']).optional(),
});

export const AxRepairInspectArgsSchema = z.object({
  repairId: z.string().trim().min(1),
});

export const AxRepairApplyArgsSchema = z.object({
  repairId: z.string().trim().min(1),
  candidateId: z.string().trim().min(1),
  baseVersion: z.number().int().min(1),
});

export const AxRepairRejectArgsSchema = z.object({
  repairId: z.string().trim().min(1),
  baseVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500).optional(),
});

/** Host-rendered UI is deliberately read-only and cannot execute a side effect. */
export const AxUiPresentArgsSchema = AxUiPresentationSchema;

export const AxContextUpdateArgsSchema = AgentScopedContextUpdateArgsSchema;

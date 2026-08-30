import { z } from 'zod';
import {
  AiDecisionStepSchema,
  HumanApprovalStepSchema,
  IfStepSchema,
  TriggerSchema,
} from '../../workflow/schema.js';
import { PortBindingSchema } from '../../workflow/port-binding.js';
import { AgentScopedContextUpdateArgsSchema } from '../scoped-context.js';

/**
 * AX commands are the model-facing boundary. They are intentionally narrower
 * than the storage and runtime APIs: an agent can request a domain operation,
 * but it cannot choose a database query, shell command, or connector method.
 */
export const AX_COMMAND_NAMES = [
  'command.list',
  'resource.list',
  'source.list',
  'source.files.list',
  'source.file.read',
  'source.search',
  'session.source.list',
  'session.source.read',
  'capability.list',
  'capability.invoke',
  'capability.describe',
  'workflow.list',
  'workflow.inspect',
  'workflow.validate',
  'workflow.create',
  'workflow.update',
  'workflow.delete',
  'workflow.run',
  'execution.enqueue_once',
  'execution.explain',
  'repair.list',
  'repair.inspect',
  'repair.apply',
  'repair.reject',
  'job.propose',
  'job.commit',
  'context.update',
  'ui.present',
  'discovery.start',
  'discovery.inspect',
  'discovery.cancel',
  'discovery.retry',
  'discovery.answer',
  'discovery.publish',
] as const;

export type AxCommandName = (typeof AX_COMMAND_NAMES)[number];

export const AxCommandSchema = z.object({
  name: z.enum(AX_COMMAND_NAMES),
  args: z.record(z.unknown()).default({}),
});

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

export type AxCommand = z.infer<typeof AxCommandSchema>;

export const AxCommandIssueSchema = z.object({
  code: z.string(),
  path: z.string().optional(),
  message: z.string(),
  expected: z.array(z.string()).optional(),
  available: z.array(z.string()).optional(),
});

export type AxCommandIssue = z.infer<typeof AxCommandIssueSchema>;

export const AxInputRequestTypeSchema = z.enum([
  'text',
  'email',
  'slack_channel',
  'folder',
]);

export const AxInputRequestSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: AxInputRequestTypeSchema,
  required: z.boolean().default(true),
  placeholder: z.string().optional(),
  reason: z.string().optional(),
});

export type AxInputRequest = z.infer<typeof AxInputRequestSchema>;

/**
 * A presentation is a bounded, host-rendered interaction—not executable UI.
 * Actions carry user-facing text; they never
 * carry command names, connector calls, HTML, or code.
 */
export const AxUiPresentationActionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(500),
  tone: z.enum(['primary', 'secondary', 'danger']).default('secondary'),
  /** A typed host confirmation marker; it is not a command or permission. */
  purpose: z.enum(['reply', 'confirm_context', 'confirm_job']).default('reply'),
});

export const AxUiPresentationBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('source'),
    fileName: z.string().trim().min(1).max(240),
    detail: z.string().trim().max(800).optional(),
    citation: z.string().trim().max(240).optional(),
  }),
  z.object({
    type: z.literal('decision'),
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(240),
    reason: z.string().trim().max(1_200).optional(),
  }),
  z.object({
    type: z.literal('steps'),
    title: z.string().trim().max(120).optional(),
    items: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  }),
  z.object({
    type: z.literal('note'),
    text: z.string().trim().min(1).max(1_200),
  }),
]);

export const AxUiPresentationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(300).optional(),
  blocks: z.array(AxUiPresentationBlockSchema).max(12).default([]),
  inputs: z.array(AxInputRequestSchema).max(8).default([]),
  actions: z.array(AxUiPresentationActionSchema).max(8).default([]),
});

export type AxUiPresentation = z.infer<typeof AxUiPresentationSchema>;

export const AxCommandLifecycleSchema = z.enum([
  'read',
  'present',
  'ephemeral',
  'workflow',
  'context',
  'run',
]);

export type AxCommandLifecycle = z.infer<typeof AxCommandLifecycleSchema>;

export const AxCommandStatusSchema = z.enum([
  'ok',
  'needs_input',
  'not_found',
  'conflict',
  'invalid',
  'forbidden',
  'queued',
  'error',
]);

export type AxCommandStatus = z.infer<typeof AxCommandStatusSchema>;

export const AxCommandResultSchema = z.object({
  command: z.string(),
  status: AxCommandStatusSchema,
  data: z.unknown().optional(),
  issues: z.array(AxCommandIssueSchema).default([]),
  inputRequests: z.array(AxInputRequestSchema).default([]),
});

export type AxCommandResult = z.infer<typeof AxCommandResultSchema>;

export interface AxCommandDefinition {
  name: AxCommandName;
  lifecycle: AxCommandLifecycle;
  description: string;
  args: Record<string, string>;
  mutates: boolean;
}

/** The agent may describe an action, but the catalog supplies its risk level. */
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

export function parseAxCommand(value: unknown): AxCommand {
  return AxCommandSchema.parse(value);
}

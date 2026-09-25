import { z } from 'zod';
import { CONNECTOR_FAILURE_KINDS } from '../../../../connectors/types.js';

export const AxInputRequestTypeSchema = z.enum([
  'text',
  'email',
  'slack_channel',
  'folder',
]);

export const AxInputRequestOptionSchema = z.object({
  /** Stable host-owned value sent back to the command agent after selection. */
  value: z.string().trim().min(1).max(256),
  /** Human-readable label; ids and secrets do not need to be shown here. */
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(240).optional(),
});

export const AX_INPUT_REQUEST_MAX_OPTIONS = 200;
export const AX_INPUT_REQUEST_MAX_COUNT = 8;

export type AxInputRequestOption = z.infer<typeof AxInputRequestOptionSchema>;

export const AxInputRequestSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: AxInputRequestTypeSchema,
  /** Identifies the exact command-owned field group; action inputs use stepId/capabilityId. */
  target: z.enum(['trigger', 'job']).optional(),
  required: z.boolean().default(true),
  /** Host scope for a missing parameter in an executable workflow step. */
  stepId: z.string().min(1).max(128).optional(),
  capabilityId: z.string().min(1).max(256).optional(),
  parameterName: z.string().min(1).max(128).optional(),
  placeholder: z.string().optional(),
  reason: z.string().optional(),
  options: z.array(AxInputRequestOptionSchema).max(AX_INPUT_REQUEST_MAX_OPTIONS).optional(),
});

export type AxInputRequest = z.infer<typeof AxInputRequestSchema>;

export const AxContextUpdateConfirmationSchema = z.object({
  scope: z.enum(['session', 'workflow']),
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  value: z.string().trim().min(1).max(1_200),
  workflowId: z.string().trim().min(1).max(128).optional(),
}).superRefine((confirmation, context) => {
  if (confirmation.scope === 'workflow' && !confirmation.workflowId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflowId'],
      message: 'workflow 컨텍스트 확인에는 workflow id가 필요합니다.',
    });
  }
  if (confirmation.scope === 'session' && confirmation.workflowId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflowId'],
      message: 'session 컨텍스트 확인에는 workflow id를 사용할 수 없습니다.',
    });
  }
});

export type AxContextUpdateConfirmation = z.infer<typeof AxContextUpdateConfirmationSchema>;

export const AxCommandIssueSchema = z.object({
  code: z.string(),
  /** Sanitized failure class used for safe agent recovery, never provider text. */
  failureKind: z.enum(CONNECTOR_FAILURE_KINDS).optional(),
  path: z.string().optional(),
  message: z.string(),
  details: z.unknown().optional(),
  expected: z.array(z.string()).optional(),
  available: z.array(z.string()).optional(),
  inputRequests: z.array(AxInputRequestSchema).max(AX_INPUT_REQUEST_MAX_COUNT).optional(),
});

export type AxCommandIssue = z.infer<typeof AxCommandIssueSchema>;

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
  /** Exact host-executed memory proposal bound to this confirmation action. */
  contextUpdate: AxContextUpdateConfirmationSchema.optional(),
}).superRefine((action, context) => {
  if (action.contextUpdate && action.purpose !== 'confirm_context') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contextUpdate'],
      message: '컨텍스트 저장 데이터는 confirm_context action에만 연결할 수 있습니다.',
    });
  }
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
  inputMode: z.enum(['individual', 'batch']).default('individual'),
  blocks: z.array(AxUiPresentationBlockSchema).max(12).default([]),
  inputs: z.array(AxInputRequestSchema).max(AX_INPUT_REQUEST_MAX_COUNT).default([]),
  actions: z.array(AxUiPresentationActionSchema).max(8).default([]),
});

export type AxUiPresentation = z.infer<typeof AxUiPresentationSchema>;

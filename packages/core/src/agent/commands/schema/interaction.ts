import { z } from 'zod';

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

export type AxInputRequestOption = z.infer<typeof AxInputRequestOptionSchema>;

export const AxInputRequestSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: AxInputRequestTypeSchema,
  required: z.boolean().default(true),
  placeholder: z.string().optional(),
  reason: z.string().optional(),
  options: z.array(AxInputRequestOptionSchema).max(200).optional(),
});

export type AxInputRequest = z.infer<typeof AxInputRequestSchema>;

export const AxCommandIssueSchema = z.object({
  code: z.string(),
  path: z.string().optional(),
  message: z.string(),
  details: z.unknown().optional(),
  expected: z.array(z.string()).optional(),
  available: z.array(z.string()).optional(),
  inputRequests: z.array(AxInputRequestSchema).max(8).optional(),
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
  inputs: z.array(AxInputRequestSchema).max(8).default([]),
  actions: z.array(AxUiPresentationActionSchema).max(8).default([]),
});

export type AxUiPresentation = z.infer<typeof AxUiPresentationSchema>;

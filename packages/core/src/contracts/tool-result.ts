import { z } from 'zod';

const id = z.string().min(1).max(128);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const header = z.string().max(2_000).refine(value => !/[\r\n\0]/u.test(value), 'Invalid message header');
const content = z.string().max(60_000);

/** Literal editable data, never a command, template or credential. */
export const MessageToolDraftSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('gmail'), to: header, subject: header, body: content }).strict(),
  z.object({ tool: z.literal('slack'), channel: header, text: content }).strict(),
]);
export type MessageToolDraft = z.infer<typeof MessageToolDraftSchema>;

/** Persist only references. Full preview/draft bodies are fetched into memory. */
export const ToolResultReferenceSchema = z.object({
  approvalId: id, executionId: id, workspaceSessionId: id, actionId: id,
  paramsHash: digest, tool: z.enum(['gmail', 'slack']),
}).strict();
export type ToolResultReference = z.infer<typeof ToolResultReferenceSchema>;

export const EditableToolResultSchema = ToolResultReferenceSchema.extend({
  connectionRevision: z.number().int().nonnegative(),
  connectionHash: digest,
  draft: MessageToolDraftSchema,
  revision: z.number().int().nonnegative(),
  blockedFields: z.array(z.string().max(128)).max(64),
  threadReference: header.optional(),
}).strict();
export type EditableToolResult = z.infer<typeof EditableToolResultSchema>;

/** Produced by an authenticated host connector, never inferred from a label. */
export const MessageSendBindingSchema = z.object({
  provider: z.enum(['gmail', 'slack']),
  accountId: id, accountLabel: z.string().min(1).max(240),
  workspaceId: id.optional(), workspaceLabel: z.string().min(1).max(240).optional(),
  destinationId: header.refine(value => value.length > 0), destinationLabel: header.refine(value => value.length > 0),
}).strict();
export type MessageSendBinding = z.infer<typeof MessageSendBindingSchema>;

export const ToolDraftUpdateSchema = z.object({
  approvalId: id, workspaceSessionId: id, revision: z.number().int().nonnegative(),
  draft: MessageToolDraftSchema,
}).strict();
export type ToolDraftUpdate = z.infer<typeof ToolDraftUpdateSchema>;
export const ToolReviewRequestSchema = ToolDraftUpdateSchema.omit({ draft: true });
export type ToolReviewRequest = z.infer<typeof ToolReviewRequestSchema>;

export const ToolResultConfirmationSchema = z.object({
  approvalId: id, workspaceSessionId: id, sealId: z.string().uuid(),
}).strict();
export type ToolResultConfirmation = z.infer<typeof ToolResultConfirmationSchema>;
export const ToolResultReviewSchema = z.object({
  confirmation: ToolResultConfirmationSchema,
  revision: z.number().int().nonnegative(), draft: MessageToolDraftSchema,
  binding: MessageSendBindingSchema, paramsHash: digest,
}).strict();
export type ToolResultReview = z.infer<typeof ToolResultReviewSchema>;

export const ToolSendOutcomeSchema = z.object({
  status: z.enum(['sent', 'unknown']), binding: MessageSendBindingSchema,
  paramsHash: digest, receiptId: z.string().min(1).max(128).optional(),
}).strict().refine(value => value.status !== 'sent' || !!value.receiptId);
export type ToolSendOutcome = z.infer<typeof ToolSendOutcomeSchema>;

/** The only fields a message send takes, per tool; anything else is not a message the person reviews. */
export const MESSAGE_TOOL_FIELDS = {
  gmail: ['to', 'subject', 'body'],
  slack: ['channel', 'text'],
} as const satisfies Record<'gmail' | 'slack', readonly string[]>;

export function isMessageToolField(tool: keyof typeof MESSAGE_TOOL_FIELDS, key: string): boolean {
  return (MESSAGE_TOOL_FIELDS[tool] as readonly string[]).includes(key);
}

export function messageTool(actionRef: string): 'gmail' | 'slack' | undefined {
  return actionRef === 'gmail.message.send' ? 'gmail' : actionRef === 'slack.message.send' ? 'slack' : undefined;
}
export function messageToolDraft(actionRef: string, params: Record<string, unknown>): MessageToolDraft | undefined {
  const tool = messageTool(actionRef);
  if (!tool) return undefined;
  const keys = MESSAGE_TOOL_FIELDS[tool];
  if (Object.keys(params).some(key => !isMessageToolField(tool, key))) return undefined;
  const parsed = MessageToolDraftSchema.safeParse({ tool, ...Object.fromEntries(keys.map(key => [key, params[key] ?? ''])) });
  return parsed.success ? parsed.data : undefined;
}
export function messageToolParams(draft: MessageToolDraft): Record<string, unknown> {
  return draft.tool === 'gmail'
    ? { to: draft.to, subject: draft.subject, body: draft.body }
    : { channel: draft.channel, text: draft.text };
}
export function missingToolEssentials(draft: MessageToolDraft): string[] {
  return draft.tool === 'gmail'
    ? [...(!draft.to.trim() ? ['recipient'] : []), ...(!draft.body.trim() ? ['body'] : [])]
    : [...(!draft.channel.trim() ? ['channel'] : []), ...(!draft.text.trim() ? ['message'] : [])];
}
export function validGmailRecipient(to: string): boolean {
  return to.split(',').every(part => {
    const address = part.trim().match(/^(?:[^<>]*<)?([^<>\s]+@[^<>\s]+\.[^<>\s]+)>?$/u)?.[1];
    return !!address && z.string().email().safeParse(address).success;
  });
}

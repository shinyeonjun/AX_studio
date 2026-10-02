import { z } from 'zod';
import {
  AxInputRequestSchema,
  AxUiPresentationSchema,
  type AxInputRequest,
  type AxUiPresentation,
} from '../../../intelligence/agent/commands/schema.js';
import {
  ExecutionResultStatusSchema,
  type ExecutionResultStatus,
} from '../../../contracts/execution-status.js';
import { TableArtifactSchema, type TableArtifact } from '../../../contracts/artifacts/table.js';

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Stable persisted turn identity; old transcripts may omit it. */
  turnId?: string;
  /** Host-authored durable CAS membership, not permission or a routing preference. */
  registeredMetadataTurn?: true;
  /** Host-generated durable result, distinguishable from a normal reply. */
  kind?: 'execution_result';
  /** Execution id used to make background result delivery idempotent. */
  executionId?: string;
  /** Structured lifecycle state for host-generated execution results. */
  executionStatus?: ExecutionResultStatus;
  /** UI hint only; main still requires the matching host-held command and request IDs. */
  inputContinuation?: 'command';
  /** Optional host-rendered controls attached to this assistant message. */
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
  /** Direct host action for a pending one-shot execution approval. */
  approval?: WorkspaceChatApproval;
  /** Safe metadata for a generated PDF; the host keeps the physical artifact path. */
  generatedPdf?: WorkspaceChatGeneratedPdf;
  generatedSpreadsheet?: WorkspaceChatGeneratedSpreadsheet;
  /** Bounded table shown in this reply, for immediate follow-up operations. */
  readResult?: TableArtifact;
}

export interface WorkspaceChatApproval {
  id: string;
  title: string;
  reason: string;
}

/** Safe, renderer-facing metadata for a generated PDF. Physical paths and bytes stay host-owned. */
export interface WorkspaceChatGeneratedPdf {
  artifactId: string;
  fileName: string;
  size: number;
  mimeType: 'application/pdf';
}

export const WorkspaceChatApprovalSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(1_200),
});

export const WorkspaceChatGeneratedPdfSchema = z.object({
  artifactId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  fileName: z.string()
    .trim()
    .min(1)
    .max(180)
    .refine((value) => !value.includes('/') && !value.includes('\\'), 'fileName은 파일 이름이어야 합니다.'),
  size: z.number().int().nonnegative(),
  mimeType: z.literal('application/pdf'),
});

export const WorkspaceChatGeneratedSpreadsheetSchema = WorkspaceChatGeneratedPdfSchema.extend({
  fileName: WorkspaceChatGeneratedPdfSchema.shape.fileName.refine(value => value.toLowerCase().endsWith('.xlsx')),
  mimeType: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
});
export type WorkspaceChatGeneratedSpreadsheet = z.infer<typeof WorkspaceChatGeneratedSpreadsheetSchema>;

export const WorkspaceChatReadResultSchema = TableArtifactSchema.pick({
  id: true,
  kind: true,
  name: true,
  columns: true,
  rows: true,
  truncated: true,
  completeness: true,
}).superRefine((table, context) => {
  if (table.columns.length > 50 || table.rows.length > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '이전 표 결과는 100행·50열 이내여야 합니다.' });
  }
  if (new TextEncoder().encode(JSON.stringify(table)).byteLength > 64_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '이전 표 결과는 64KB 이내여야 합니다.' });
  }
});

export type WorkspaceChatReadResult = z.infer<typeof WorkspaceChatReadResultSchema>;

export interface WorkspaceChatRecord {
  id: string;
  title: string;
  messages: WorkspaceChatMessage[];
  workflowId?: string;
  updatedAt: string;
  /** Opaque token owned by this main-process database instance, never durable authority. */
  transcriptRevision?: string;
  /** Listed rows can be marked when old/corrupt JSON needs user deletion. */
  corrupted?: boolean;
}

/**
 * List rows intentionally omit messages: rendering the session list must not
 * pay for parsing every stored transcript. Open a chat to load its messages.
 */
export interface WorkspaceChatListRecord {
  id: string;
  title: string;
  workflowId?: string;
  updatedAt: string;
  sourceCount: number;
  corrupted?: boolean;
}

export const workspaceChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  turnId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).optional(),
  registeredMetadataTurn: z.literal(true).optional(),
  kind: z.literal('execution_result').optional(),
  executionId: z.string().min(1).max(128).optional(),
  executionStatus: ExecutionResultStatusSchema.optional(),
  inputContinuation: z.literal('command').optional(),
  inputRequests: z.array(AxInputRequestSchema).max(8).optional(),
  presentations: z.array(AxUiPresentationSchema).max(4).optional(),
  approval: WorkspaceChatApprovalSchema.optional(),
  generatedPdf: WorkspaceChatGeneratedPdfSchema.optional(),
  generatedSpreadsheet: WorkspaceChatGeneratedSpreadsheetSchema.optional(),
  readResult: WorkspaceChatReadResultSchema.optional(),
}).superRefine((message, context) => {
  if (message.registeredMetadataTurn && (message.role !== 'user' || !message.turnId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['registeredMetadataTurn'], message: 'invalid_registered_metadata_turn' });
  }
  if (message.approval && message.kind !== 'execution_result') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval'],
      message: 'approval은 실행 결과 메시지에만 사용할 수 있습니다.',
    });
  }
  if (message.generatedSpreadsheet && message.kind !== 'execution_result') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['generatedSpreadsheet'], message: 'Excel 산출물은 실행 결과에만 표시합니다.' });
  }
  if (message.generatedPdf && message.kind !== 'execution_result') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['generatedPdf'],
      message: 'generatedPdf는 실행 결과 메시지에만 사용할 수 있습니다.',
    });
  }
  if (message.readResult && message.role !== 'assistant') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['readResult'],
      message: 'readResult는 assistant 메시지에만 사용할 수 있습니다.',
    });
  }
});

export const workspaceChatMessagesSchema = z.array(workspaceChatMessageSchema);

export interface WorkspaceChatSaveOptions {
  expectedTranscriptRevision?: string;
  /** Internal admission preference, never permission or a source identity. */
  metadataLane?: 'registered_http_metadata';
}

export interface WorkspaceChatPersistedReplyReceipt {
  kind: 'registered_http_metadata';
  sessionId: string;
  requestId: string;
  turnId: string;
  requestGeneration: number;
  transcriptRevision: string;
}

export function parseMessages(messagesJson: string, id: string): WorkspaceChatMessage[] {
  let raw: unknown;
  try {
    raw = JSON.parse(messagesJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(
      'workspace chat ' + id + ' messages are corrupted: ' + detail,
    ), {
      code: 'invalid_workspace_chat_json',
      chatId: id,
    });
  }
  const parsed = workspaceChatMessagesSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(
      'workspace chat ' + id + ' messages have an invalid shape',
    ), {
      code: 'invalid_workspace_chat_messages',
      chatId: id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

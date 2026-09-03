import { z } from 'zod';
import {
  AxInputRequestSchema,
  AxUiPresentationSchema,
  type AxInputRequest,
  type AxUiPresentation,
} from '../../../agent/commands/schema.js';
import {
  ExecutionResultStatusSchema,
  type ExecutionResultStatus,
} from '../../../contracts/execution-status.js';

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Host-generated durable result, distinguishable from a normal reply. */
  kind?: 'execution_result';
  /** Execution id used to make background result delivery idempotent. */
  executionId?: string;
  /** Structured lifecycle state for host-generated execution results. */
  executionStatus?: ExecutionResultStatus;
  /** Optional host-rendered controls attached to this assistant message. */
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
  /** Direct host action for a pending one-shot execution approval. */
  approval?: WorkspaceChatApproval;
}

export interface WorkspaceChatApproval {
  id: string;
  title: string;
  reason: string;
}

export const WorkspaceChatApprovalSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(1_200),
});

export interface WorkspaceChatRecord {
  id: string;
  title: string;
  messages: WorkspaceChatMessage[];
  workflowId?: string;
  updatedAt: string;
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
  kind: z.literal('execution_result').optional(),
  executionId: z.string().min(1).max(128).optional(),
  executionStatus: ExecutionResultStatusSchema.optional(),
  inputRequests: z.array(AxInputRequestSchema).max(8).optional(),
  presentations: z.array(AxUiPresentationSchema).max(4).optional(),
  approval: WorkspaceChatApprovalSchema.optional(),
}).superRefine((message, context) => {
  if (message.approval && message.kind !== 'execution_result') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval'],
      message: 'approval은 실행 결과 메시지에만 사용할 수 있습니다.',
    });
  }
});

export const workspaceChatMessagesSchema = z.array(workspaceChatMessageSchema);

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

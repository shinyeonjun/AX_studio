import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppDatabase } from '../db.js';
import { listWorkspaceSources } from './workspace-source-repository.js';
import {
  type AgentScopedContextMap,
  type AgentScopedContextPatch,
  mergeAgentScopedContext,
  parseStoredAgentScopedContext,
} from '../../agent/scoped-context.js';
import {
  AxInputRequestSchema,
  AxUiPresentationSchema,
  type AxInputRequest,
  type AxUiPresentation,
} from '../../agent/commands/schema.js';
import {
  ExecutionResultStatusSchema,
  type ExecutionResultStatus,
} from '../../contracts/execution-status.js';

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
 * List rows intentionally omit `messages`: rendering the session list must not
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

const WorkspaceChatMessageSchema = z.object({
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
const WorkspaceChatMessagesSchema = z.array(WorkspaceChatMessageSchema);

function parseMessages(messagesJson: string, id: string): WorkspaceChatMessage[] {
  let raw: unknown;
  try {
    raw = JSON.parse(messagesJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`workspace chat ${id} messages are corrupted: ${detail}`), {
      code: 'invalid_workspace_chat_json',
      chatId: id,
    });
  }
  const parsed = WorkspaceChatMessagesSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(`workspace chat ${id} messages have an invalid shape`), {
      code: 'invalid_workspace_chat_messages',
      chatId: id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function deriveWorkspaceChatTitle(
  messages: WorkspaceChatMessage[],
  sources: Array<{ fileName: string }>,
): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  if (firstUser) {
    const text = firstUser.content.trim();
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }
  if (sources.length === 1) return sources[0]!.fileName;
  if (sources.length > 1) return `${sources[0]!.fileName} 외 ${sources.length - 1}개`;
  return '새 대화';
}

export function refreshWorkspaceChatTitle(db: AppDatabase, sessionId: string): string | null {
  const chat = getWorkspaceChat(db, sessionId);
  if (!chat) return null;
  const sources = listWorkspaceSources(db, sessionId);
  const title = deriveWorkspaceChatTitle(chat.messages, sources);
  const now = new Date().toISOString();
  db.prepare('UPDATE workspace_chats SET title = ?, updated_at = ? WHERE id = ?').run(title, now, sessionId);
  return title;
}

export function getWorkspaceChatMemo(db: AppDatabase, sessionId: string): AgentScopedContextMap {
  const row = db.prepare('SELECT session_memo_json FROM workspace_chats WHERE id = ?').get(sessionId) as
    | { session_memo_json?: string | null }
    | undefined;
  return parseStoredAgentScopedContext(row?.session_memo_json);
}

export function updateWorkspaceChatMemo(
  db: AppDatabase,
  sessionId: string,
  patch: AgentScopedContextPatch,
): AgentScopedContextMap | null {
  const current = db.prepare('SELECT id, session_memo_json FROM workspace_chats WHERE id = ?').get(sessionId) as
    | { id: string; session_memo_json?: string | null }
    | undefined;
  if (!current) return null;
  const next = mergeAgentScopedContext(parseStoredAgentScopedContext(current.session_memo_json), patch);
  db.prepare('UPDATE workspace_chats SET session_memo_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), new Date().toISOString(), sessionId);
  return next;
}

export function saveWorkspaceChat(
  db: AppDatabase,
  params: {
    id?: string;
    messages: WorkspaceChatMessage[];
    /** Omitted preserves an existing mapping; null explicitly clears it. */
    workflowId?: string | null;
  },
): WorkspaceChatRecord {
  const parsedMessages = WorkspaceChatMessagesSchema.parse(params.messages);
  const now = new Date().toISOString();
  const id = params.id?.trim() || randomUUID();
  const existing = db.prepare('SELECT id, workflow_id, messages_json FROM workspace_chats WHERE id = ?').get(id) as
    | { id: string; workflow_id?: string | null; messages_json?: string }
    | undefined;
  let messages = parsedMessages;
  if (existing?.messages_json) {
    try {
      const persisted = parseMessages(existing.messages_json, id);
      const incomingExecutionIds = new Set(
        parsedMessages
          .filter((message) => message.kind === 'execution_result' && message.executionId)
          .map((message) => message.executionId),
      );
      const backgroundResults = persisted.filter(
        (message) =>
          message.kind === 'execution_result' &&
          message.executionId &&
          !incomingExecutionIds.has(message.executionId),
      );
      messages = [...parsedMessages, ...backgroundResults];
    } catch {
      // An incoming full transcript can still repair an old corrupt row. The
      // persisted result merge is only a race-preservation aid.
    }
  }
  const sources = existing || params.id ? listWorkspaceSources(db, id) : [];
  const title = deriveWorkspaceChatTitle(messages, sources);
  const messagesJson = JSON.stringify(messages);

  if (existing) {
    if (params.workflowId === undefined) {
      db.prepare(
        'UPDATE workspace_chats SET title = ?, messages_json = ?, updated_at = ? WHERE id = ?',
      ).run(title, messagesJson, now, id);
    } else {
      db.prepare(
        'UPDATE workspace_chats SET title = ?, messages_json = ?, workflow_id = ?, updated_at = ? WHERE id = ?',
      ).run(title, messagesJson, params.workflowId, now, id);
    }
  } else {
    db.prepare(
      'INSERT INTO workspace_chats (id, title, messages_json, workflow_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, title, messagesJson, params.workflowId ?? null, now, now);
  }

  const workflowId = params.workflowId === undefined ? existing?.workflow_id ?? undefined : params.workflowId ?? undefined;

  return {
    id,
    title,
    messages,
    ...(workflowId ? { workflowId } : {}),
    updatedAt: now,
  };
}

/**
 * Append or replace one host-generated execution result without allowing a
 * second delivery of the same execution to grow the transcript.
 */
export function upsertWorkspaceChatExecutionResult(
  db: AppDatabase,
  sessionId: string,
  message: WorkspaceChatMessage & { kind: 'execution_result'; executionId: string },
): WorkspaceChatRecord | null {
  const parsed = WorkspaceChatMessageSchema.parse(message);
  const existing = getWorkspaceChat(db, sessionId);
  if (!existing) return null;

  const index = existing.messages.findIndex(
    (entry) => entry.kind === 'execution_result' && entry.executionId === parsed.executionId,
  );
  const messages = [...existing.messages];
  if (index >= 0) messages[index] = parsed;
  else messages.push(parsed);

  return saveWorkspaceChat(db, { id: sessionId, messages });
}

export function getWorkspaceChat(db: AppDatabase, id: string): WorkspaceChatRecord | null {
  const row = db
    .prepare('SELECT id, title, messages_json, workflow_id, updated_at FROM workspace_chats WHERE id = ?')
    .get(id) as
    | {
        id: string;
        title: string;
        messages_json: string;
        workflow_id?: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const messages = parseMessages(row.messages_json, id);
  return {
    id: row.id,
    title: row.title,
    messages,
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    updatedAt: row.updated_at,
  };
}

export function getWorkspaceChatByWorkflowId(db: AppDatabase, workflowId: string): WorkspaceChatRecord | null {
  const row = db
    .prepare(
      'SELECT id, title, messages_json, workflow_id, updated_at FROM workspace_chats WHERE workflow_id = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(workflowId) as
    | {
        id: string;
        title: string;
        messages_json: string;
        workflow_id?: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const messages = parseMessages(row.messages_json, row.id);
  return {
    id: row.id,
    title: row.title,
    messages,
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    updatedAt: row.updated_at,
  };
}

export function listWorkspaceChats(db: AppDatabase, limit = 50): WorkspaceChatListRecord[] {
  interface ListRow {
    id: string;
    title: string;
    workflow_id?: string | null;
    updated_at: string;
    source_count: number;
    valid_json: number;
  }
  const sourceCountSql =
    '(SELECT COUNT(*) FROM workspace_chat_sources wcs WHERE wcs.chat_id = wc.id) AS source_count';
  let rows: ListRow[];
  try {
    rows = db
      .prepare(
        `SELECT wc.id, wc.title, wc.workflow_id, wc.updated_at,
                json_valid(wc.messages_json) AS valid_json,
                ${sourceCountSql}
         FROM workspace_chats wc
         ORDER BY wc.updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as ListRow[];
  } catch {
    // JSON1 unavailable: list without a validity probe rather than parsing
    // every stored transcript; a corrupt chat still fails closed on open.
    rows = db
      .prepare(
        `SELECT wc.id, wc.title, wc.workflow_id, wc.updated_at,
                1 AS valid_json,
                ${sourceCountSql}
         FROM workspace_chats wc
         ORDER BY wc.updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as ListRow[];
  }
  return rows.map((row) => {
    const corrupted = !row.valid_json;
    return {
      id: row.id,
      title: corrupted ? `${row.title || '대화'} (복구 필요)` : row.title,
      ...(row.workflow_id && !corrupted ? { workflowId: row.workflow_id } : {}),
      updatedAt: row.updated_at,
      sourceCount: Number(row.source_count) || 0,
      ...(corrupted ? { corrupted: true } : {}),
    };
  });
}

export function deleteWorkspaceChat(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM workspace_chats WHERE id = ?').run(id);
}

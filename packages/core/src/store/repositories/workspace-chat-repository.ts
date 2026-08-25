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

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Optional host-rendered controls attached to this assistant message. */
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
}

export interface WorkspaceChatRecord {
  id: string;
  title: string;
  messages: WorkspaceChatMessage[];
  workflowId?: string;
  updatedAt: string;
  /** Listed rows can be marked when old/corrupt JSON needs user deletion. */
  corrupted?: boolean;
}

export interface WorkspaceChatListRecord extends WorkspaceChatRecord {
  sourceCount: number;
}

const WorkspaceChatMessagesSchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    inputRequests: z.array(AxInputRequestSchema).max(8).optional(),
    presentations: z.array(AxUiPresentationSchema).max(4).optional(),
  }),
);

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
  const messages = WorkspaceChatMessagesSchema.parse(params.messages);
  const now = new Date().toISOString();
  const id = params.id?.trim() || randomUUID();
  const existing = db.prepare('SELECT id, workflow_id FROM workspace_chats WHERE id = ?').get(id) as
    | { id: string; workflow_id?: string | null }
    | undefined;
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
  const rows = db
    .prepare(
      `SELECT wc.id, wc.title, wc.messages_json, wc.workflow_id, wc.updated_at,
              (SELECT COUNT(*) FROM workspace_chat_sources wcs WHERE wcs.chat_id = wc.id) AS source_count
       FROM workspace_chats wc
       ORDER BY wc.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    title: string;
    messages_json: string;
    workflow_id?: string | null;
    updated_at: string;
    source_count: number;
  }>;
  return rows.map((row) => {
    try {
      return {
        id: row.id,
        title: row.title,
        messages: parseMessages(row.messages_json, row.id),
        ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
        updatedAt: row.updated_at,
        sourceCount: Number(row.source_count) || 0,
      };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'invalid_workspace_chat_json';
      return {
        id: row.id,
        title: `${row.title || '대화'} (복구 필요)`,
        messages: [],
        updatedAt: row.updated_at,
        corrupted: true,
        errorCode: code,
        sourceCount: Number(row.source_count) || 0,
      } as WorkspaceChatListRecord & { errorCode: string };
    }
  });
}

export function deleteWorkspaceChat(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM workspace_chat_sources WHERE chat_id = ?').run(id);
  db.prepare('DELETE FROM workspace_chats WHERE id = ?').run(id);
}

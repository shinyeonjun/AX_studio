import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppDatabase } from '../db.js';

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WorkspaceChatRecord {
  id: string;
  title: string;
  messages: WorkspaceChatMessage[];
  updatedAt: string;
  /** Listed rows can be marked when old/corrupt JSON needs user deletion. */
  corrupted?: boolean;
}

const WorkspaceChatMessagesSchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
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

function titleFromMessages(messages: WorkspaceChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUser) return '새 대화';
  const text = firstUser.content.trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

export function saveWorkspaceChat(
  db: AppDatabase,
  params: { id?: string; messages: WorkspaceChatMessage[] },
): WorkspaceChatRecord {
  const messages = WorkspaceChatMessagesSchema.parse(params.messages);
  const now = new Date().toISOString();
  const id = params.id?.trim() || randomUUID();
  const title = titleFromMessages(messages);
  const messagesJson = JSON.stringify(messages);
  const existing = db.prepare('SELECT id FROM workspace_chats WHERE id = ?').get(id) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE workspace_chats SET title = ?, messages_json = ?, updated_at = ? WHERE id = ?').run(
      title,
      messagesJson,
      now,
      id,
    );
  } else {
    db.prepare(
      'INSERT INTO workspace_chats (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, title, messagesJson, now, now);
  }

  return { id, title, messages, updatedAt: now };
}

export function getWorkspaceChat(db: AppDatabase, id: string): WorkspaceChatRecord | null {
  const row = db
    .prepare('SELECT id, title, messages_json, updated_at FROM workspace_chats WHERE id = ?')
    .get(id) as
    | { id: string; title: string; messages_json: string; updated_at: string }
    | undefined;
  if (!row) return null;
  const messages = parseMessages(row.messages_json, id);
  return { id: row.id, title: row.title, messages, updatedAt: row.updated_at };
}

export function listWorkspaceChats(db: AppDatabase, limit = 50): WorkspaceChatRecord[] {
  const rows = db
    .prepare('SELECT id, title, messages_json, updated_at FROM workspace_chats ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as Array<{ id: string; title: string; messages_json: string; updated_at: string }>;
  return rows.map((row) => {
    try {
      return { id: row.id, title: row.title, messages: parseMessages(row.messages_json, row.id), updatedAt: row.updated_at };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'invalid_workspace_chat_json';
      return {
        id: row.id,
        title: `${row.title || '대화'} (복구 필요)`,
        messages: [],
        updatedAt: row.updated_at,
        corrupted: true,
        errorCode: code,
      } as WorkspaceChatRecord & { errorCode: string };
    }
  });
}

export function deleteWorkspaceChat(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM workspace_chats WHERE id = ?').run(id);
}

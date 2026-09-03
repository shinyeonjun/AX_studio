import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../../db.js';
import { listWorkspaceSources } from '../workspace-source-repository.js';
import {
  parseMessages,
  workspaceChatMessageSchema,
  workspaceChatMessagesSchema,
  type WorkspaceChatMessage,
  type WorkspaceChatRecord,
} from './contracts.js';
import { deriveWorkspaceChatTitle } from './title.js';
import { getWorkspaceChat } from './queries.js';

export function saveWorkspaceChat(
  db: AppDatabase,
  params: {
    id?: string;
    messages: WorkspaceChatMessage[];
    /** Omitted preserves an existing mapping; null explicitly clears it. */
    workflowId?: string | null;
  },
): WorkspaceChatRecord {
  const parsedMessages = workspaceChatMessagesSchema.parse(params.messages);
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
  const parsed = workspaceChatMessageSchema.parse(message);
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

export function deleteWorkspaceChat(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM workspace_chats WHERE id = ?').run(id);
}

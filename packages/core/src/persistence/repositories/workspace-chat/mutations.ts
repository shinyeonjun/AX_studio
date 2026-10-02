import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../../db.js';
import { readRow } from '../../db/types.js';
import { listWorkspaceSources } from '../workspace-source-repository.js';
import {
  parseMessages,
  workspaceChatMessageSchema,
  workspaceChatMessagesSchema,
  type WorkspaceChatMessage,
  type WorkspaceChatRecord,
} from './contracts.js';
import { deriveWorkspaceChatTitle } from './title.js';
import {
  assertWorkspaceChatRevision, commitWorkspaceChatRevision, invalidateWorkspaceChatRevision,
  registerWorkspaceChatRevisionFence,
} from './revisions.js';

const MAX_WORKSPACE_CHAT_BYTES = 1_000_000;

interface ExistingWorkspaceChatRow {
  id: string;
  workflow_id?: string | null;
  messages_json: string;
}

// Both callers validate message contents and pass the row already read for this write.
function persistWorkspaceChat(
  db: AppDatabase,
  id: string,
  messages: WorkspaceChatMessage[],
  workflowId: string | null | undefined,
  existing: ExistingWorkspaceChatRow | undefined,
): WorkspaceChatRecord {
  const now = new Date().toISOString();
  const hasUserTitle = messages.some((message) => message.role === 'user' && message.content.trim());
  const sources = existing && !hasUserTitle ? listWorkspaceSources(db, id) : [];
  const title = deriveWorkspaceChatTitle(messages, sources);
  const messagesJson = JSON.stringify(messages);
  if (Buffer.byteLength(messagesJson, 'utf8') > MAX_WORKSPACE_CHAT_BYTES) {
    throw Object.assign(new Error('workspace_chat_too_large'), { code: 'workspace_chat_too_large' });
  }

  if (existing) {
    if (workflowId === undefined) {
      db.prepare(
        'UPDATE workspace_chats SET title = ?, messages_json = ?, updated_at = ? WHERE id = ?',
      ).run(title, messagesJson, now, id);
    } else {
      db.prepare(
        'UPDATE workspace_chats SET title = ?, messages_json = ?, workflow_id = ?, updated_at = ? WHERE id = ?',
      ).run(title, messagesJson, workflowId, now, id);
    }
  } else {
    db.prepare(
      'INSERT INTO workspace_chats (id, title, messages_json, workflow_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, title, messagesJson, workflowId ?? null, now, now);
  }

  const mappedWorkflowId = workflowId === undefined ? existing?.workflow_id ?? undefined : workflowId ?? undefined;
  return {
    id,
    title,
    messages,
    ...(mappedWorkflowId ? { workflowId: mappedWorkflowId } : {}),
    updatedAt: now,
  };
}

export function saveWorkspaceChat(
  db: AppDatabase,
  params: {
    id?: string;
    messages: WorkspaceChatMessage[];
    /** Omitted preserves an existing mapping; null explicitly clears it. */
    workflowId?: string | null;
    expectedTranscriptRevision?: string;
    /** Host only: never copied from renderer save options without the installed gate. */
    registeredMetadataParticipation?: boolean;
  },
  authoritativeExecutionId?: string,
): WorkspaceChatRecord {
  const parsedMessages = workspaceChatMessagesSchema.parse(params.messages);
  const requestedId = params.id?.trim();
  const id = requestedId || randomUUID();
  const existing = readRow<ExistingWorkspaceChatRow>(
    db.prepare('SELECT id, workflow_id, messages_json FROM workspace_chats WHERE id = ?'),
    id,
  );
  if (requestedId && !existing) {
    throw Object.assign(new Error('workspace_chat_not_found'), { code: 'workspace_chat_not_found' });
  }
  let persisted: WorkspaceChatMessage[] = [];
  if (existing) {
    try { persisted = parseMessages(existing.messages_json, id); } catch { /* Preserve ordinary corrupt-row repair behavior. */ }
  }
  const registeredTurns = persisted.filter(message => message.registeredMetadataTurn);
  if (registeredTurns.length) registerWorkspaceChatRevisionFence(db, id);
  if (existing) assertWorkspaceChatRevision(db, id, params.expectedTranscriptRevision, params.registeredMetadataParticipation);
  if (registeredTurns.some(registered => !parsedMessages.some(message => message.role === registered.role
    && message.turnId === registered.turnId && message.content === registered.content))) {
    throw Object.assign(new Error('workspace_chat_turn_conflict'), { code: 'workspace_chat_turn_conflict' });
  }
  // Renderer flags cannot mint membership or remove a previously host-authored mark.
  for (const message of parsedMessages) {
    delete message.registeredMetadataTurn;
    if (registeredTurns.some(registered => registered.turnId === message.turnId && registered.role === message.role)) message.registeredMetadataTurn = true;
  }
  if (params.registeredMetadataParticipation) {
    const previousUsers = existing ? parseMessages(existing.messages_json, id).filter(message => message.role === 'user') : [];
    const incomingUsers = parsedMessages.filter(message => message.role === 'user');
    const newest = incomingUsers.at(-1);
    if (incomingUsers.length !== previousUsers.length + 1 || !newest?.turnId
      || previousUsers.some((message, index) => message.turnId !== incomingUsers[index]?.turnId || message.content !== incomingUsers[index]?.content)
      || previousUsers.some(message => message.turnId === newest.turnId)) {
      throw Object.assign(new Error('workspace_chat_turn_conflict'), { code: 'workspace_chat_turn_conflict' });
    }
    newest.registeredMetadataTurn = true;
  }
  let messages = parsedMessages;
  if (existing?.messages_json) {
    try {
      const hostResults = new Map(persisted
        .filter((message) => message.kind === 'execution_result' && message.executionId)
        .map((message) => [message.executionId, message]));
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
      messages = [...parsedMessages.map((message) =>
        message.kind === 'execution_result' && message.executionId !== authoritativeExecutionId
          ? hostResults.get(message.executionId) ?? message
          : message,
      ), ...backgroundResults];
    } catch {
      // An incoming full transcript can still repair an old corrupt row. The
      // persisted result merge is only a race-preservation aid.
    }
  }
  const saved = persistWorkspaceChat(db, id, messages, params.workflowId, existing);
  return commitWorkspaceChatRevision(db, saved, params.registeredMetadataParticipation);
}

/**
 * Append or replace one host-generated execution result without allowing a
 * second delivery of the same execution to grow the transcript.
 */
export function upsertWorkspaceChatExecutionResult(
  db: AppDatabase,
  target: string | { workflowId: string },
  message: WorkspaceChatMessage & { kind: 'execution_result'; executionId: string },
): WorkspaceChatRecord | null {
  const parsed = workspaceChatMessageSchema.parse(message);
  db.exec('BEGIN IMMEDIATE');
  try {
    const lookup = typeof target === 'string'
      ? {
          sql: 'SELECT id, workflow_id, messages_json FROM workspace_chats WHERE id = ?',
          value: target,
        }
      : {
          sql: 'SELECT id, workflow_id, messages_json FROM workspace_chats WHERE workflow_id = ? ORDER BY updated_at DESC LIMIT 1',
          value: target.workflowId,
        };
    const existing = readRow<ExistingWorkspaceChatRow>(
      db.prepare(lookup.sql),
      lookup.value,
    );
    if (!existing) {
      db.exec('COMMIT');
      return null;
    }
    const existingMessages = parseMessages(existing.messages_json, existing.id);

    const index = existingMessages.findIndex(
      (entry) => entry.kind === 'execution_result' && entry.executionId === parsed.executionId,
    );
    const messages = [...existingMessages];
    if (index >= 0) messages[index] = parsed;
    else messages.push(parsed);

    const saved = persistWorkspaceChat(db, existing.id, messages, undefined, existing);
    db.exec('COMMIT');
    return commitWorkspaceChatRevision(db, saved);
  } catch (error) {
    db.exec('ROLLBACK');
    if ((error as { code?: unknown })?.code === 'workspace_chat_not_found') return null;
    throw error;
  }
}

export function deleteWorkspaceChat(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM workspace_chats WHERE id = ?').run(id);
  invalidateWorkspaceChatRevision(db, id);
}

/** Host-owned synchronous append: no renderer full snapshot is accepted here. */
export function appendWorkspaceChatMetadataReply(db: AppDatabase, input: {
  sessionId: string; turnId: string; userText: string; reply: string;
  expectedTranscriptRevision: string; assertCurrent: () => void;
}): WorkspaceChatRecord {
  assertWorkspaceChatRevision(db, input.sessionId, input.expectedTranscriptRevision);
  const existing = readRow<ExistingWorkspaceChatRow>(
    db.prepare('SELECT id, workflow_id, messages_json FROM workspace_chats WHERE id = ?'), input.sessionId);
  if (!existing) throw Object.assign(new Error('workspace_chat_not_found'), { code: 'workspace_chat_not_found' });
  const messages = parseMessages(existing.messages_json, existing.id);
  const matches = messages.filter(message => message.role === 'user' && message.turnId === input.turnId);
  const latestUser = messages.filter(message => message.role === 'user').at(-1);
  if (matches.length !== 1 || matches[0]?.content !== input.userText || latestUser?.turnId !== input.turnId) {
    throw Object.assign(new Error('workspace_chat_turn_conflict'), { code: 'workspace_chat_turn_conflict' });
  }
  const assistant = workspaceChatMessageSchema.parse({ role: 'assistant', content: input.reply });
  // No await between these checks and SQL. Current generations and revisions cannot interleave.
  input.assertCurrent();
  assertWorkspaceChatRevision(db, input.sessionId, input.expectedTranscriptRevision);
  const saved = persistWorkspaceChat(db, existing.id, [...messages, assistant], undefined, existing);
  return commitWorkspaceChatRevision(db, saved);
}

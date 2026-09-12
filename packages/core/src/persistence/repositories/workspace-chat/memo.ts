import type { AppDatabase } from '../../db.js';
import { readRow } from '../../db/types.js';
import {
  type AgentScopedContextMap,
  type AgentScopedContextPatch,
  mergeAgentScopedContext,
  parseStoredAgentScopedContext,
} from '../../../intelligence/agent/scoped-context.js';

export function getWorkspaceChatMemo(db: AppDatabase, sessionId: string): AgentScopedContextMap {
  const row = readRow<{ session_memo_json?: string | null }>(
    db.prepare('SELECT session_memo_json FROM workspace_chats WHERE id = ?'),
    sessionId,
  );
  return parseStoredAgentScopedContext(row?.session_memo_json);
}

export function updateWorkspaceChatMemo(
  db: AppDatabase,
  sessionId: string,
  patch: AgentScopedContextPatch,
): AgentScopedContextMap | null {
  const current = readRow<{ id: string; session_memo_json?: string | null }>(
    db.prepare('SELECT id, session_memo_json FROM workspace_chats WHERE id = ?'),
    sessionId,
  );
  if (!current) return null;
  const next = mergeAgentScopedContext(parseStoredAgentScopedContext(current.session_memo_json), patch);
  db.prepare('UPDATE workspace_chats SET session_memo_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), new Date().toISOString(), sessionId);
  return next;
}

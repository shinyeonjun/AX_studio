import type { AppDatabase } from '../../db.js';
import {
  type AgentScopedContextMap,
  type AgentScopedContextPatch,
  mergeAgentScopedContext,
  parseStoredAgentScopedContext,
} from '../../../agent/scoped-context.js';

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

import type { AppDatabase } from '../../db.js';
import { listWorkspaceSources } from '../workspace-source-repository.js';
import type { WorkspaceChatMessage } from './contracts.js';
import { getWorkspaceChat } from './queries.js';

export function deriveWorkspaceChatTitle(
  messages: WorkspaceChatMessage[],
  sources: Array<{ fileName: string }>,
): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  if (firstUser) {
    const text = firstUser.content.trim();
    return text.length > 48 ? text.slice(0, 48) + '…' : text;
  }
  if (sources.length === 1) return sources[0]!.fileName;
  if (sources.length > 1) return sources[0]!.fileName + ' 외 ' + (sources.length - 1) + '개';
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

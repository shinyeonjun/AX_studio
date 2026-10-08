import type { AppDatabase } from '../db.js';
import { readRow, readRows } from '../db/types.js';

/**
 * Host-only state of a conversation, one value per kind: what the renderer-saved transcript must
 * not supply (a pending job draft and its token, the rows on screen). Values are JSON.
 */
export function getChatHostState(db: AppDatabase, chatId: string, kind: string): string | undefined {
  return readRow<{ value_json: string }>(
    db.prepare('SELECT value_json FROM workspace_chat_host_state WHERE chat_id = ? AND kind = ?'), chatId, kind,
  )?.value_json;
}

export function setChatHostState(db: AppDatabase, chatId: string, kind: string, valueJson: string): void {
  db.prepare(
    `INSERT INTO workspace_chat_host_state (chat_id, kind, value_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id, kind) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(chatId, kind, valueJson, new Date().toISOString());
}

export function deleteChatHostState(db: AppDatabase, chatId: string, kind: string): void {
  db.prepare('DELETE FROM workspace_chat_host_state WHERE chat_id = ? AND kind = ?').run(chatId, kind);
}

export function countChatHostState(db: AppDatabase, kind: string): number {
  return Number(readRow<{ count: number }>(
    db.prepare('SELECT COUNT(*) AS count FROM workspace_chat_host_state WHERE kind = ?'), kind,
  )?.count ?? 0);
}

/** Oldest first. */
export function listChatHostState(db: AppDatabase, kind: string): Array<{ chatId: string; valueJson: string }> {
  return readRows<{ chat_id: string; value_json: string }>(
    db.prepare('SELECT chat_id, value_json FROM workspace_chat_host_state WHERE kind = ? ORDER BY updated_at, chat_id'), kind,
  ).map((row) => ({ chatId: row.chat_id, valueJson: row.value_json }));
}

/** Drops the oldest entries of a kind so that at most `keep` remain. */
export function trimChatHostState(db: AppDatabase, kind: string, keep: number): void {
  db.prepare(
    `DELETE FROM workspace_chat_host_state WHERE kind = ? AND chat_id IN (
       SELECT chat_id FROM workspace_chat_host_state WHERE kind = ? ORDER BY updated_at DESC, chat_id DESC LIMIT -1 OFFSET ?
     )`,
  ).run(kind, kind, Math.max(0, keep));
}

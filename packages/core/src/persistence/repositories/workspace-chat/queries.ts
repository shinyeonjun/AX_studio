import type { AppDatabase } from '../../db.js';
import {
  parseMessages,
  type WorkspaceChatListRecord,
  type WorkspaceChatRecord,
} from './contracts.js';

interface ChatRow {
  id: string;
  title: string;
  messages_json: string;
  workflow_id?: string | null;
  updated_at: string;
}

function toWorkspaceChatRecord(row: ChatRow): WorkspaceChatRecord {
  const messages = parseMessages(row.messages_json, row.id);
  return {
    id: row.id,
    title: row.title,
    messages,
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    updatedAt: row.updated_at,
  };
}

export function getWorkspaceChat(db: AppDatabase, id: string): WorkspaceChatRecord | null {
  const row = db
    .prepare('SELECT id, title, messages_json, workflow_id, updated_at FROM workspace_chats WHERE id = ?')
    .get(id) as ChatRow | undefined;
  return row ? toWorkspaceChatRecord(row) : null;
}

export function getWorkspaceChatByWorkflowId(db: AppDatabase, workflowId: string): WorkspaceChatRecord | null {
  const row = db
    .prepare(
      'SELECT id, title, messages_json, workflow_id, updated_at FROM workspace_chats WHERE workflow_id = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(workflowId) as ChatRow | undefined;
  return row ? toWorkspaceChatRecord(row) : null;
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
  const query = (validitySql: string): string =>
    'SELECT wc.id, wc.title, wc.workflow_id, wc.updated_at,\n' +
    '                ' + validitySql + ' AS valid_json,\n' +
    '                ' + sourceCountSql + '\n' +
    '         FROM workspace_chats wc\n' +
    '         ORDER BY wc.updated_at DESC\n' +
    '         LIMIT ?';
  let rows: ListRow[];
  try {
    rows = db.prepare(query('json_valid(wc.messages_json)')).all(limit) as unknown as ListRow[];
  } catch {
    // JSON1 unavailable: list without a validity probe rather than parsing
    // every stored transcript; a corrupt chat still fails closed on open.
    rows = db.prepare(query('1')).all(limit) as unknown as ListRow[];
  }
  return rows.map((row) => {
    const corrupted = !row.valid_json;
    return {
      id: row.id,
      title: corrupted ? (row.title || '대화') + ' (복구 필요)' : row.title,
      ...(row.workflow_id && !corrupted ? { workflowId: row.workflow_id } : {}),
      updatedAt: row.updated_at,
      sourceCount: Number(row.source_count) || 0,
      ...(corrupted ? { corrupted: true } : {}),
    };
  });
}

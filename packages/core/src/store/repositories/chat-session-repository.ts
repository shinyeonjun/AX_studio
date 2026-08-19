import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { InterviewState } from '../../interview/interview-state.js';

export interface StoredChatSession {
  sessionId: string;
  workflowId?: string;
  title: string;
  summary?: string;
  state: InterviewState;
  updatedAt: string;
}

interface PersistedPayload {
  state: InterviewState;
  summary?: string;
}

function sessionTitle(state: InterviewState): string {
  return state.draft?.name?.trim() || state.workflow?.name?.trim() || state.userInstruction.slice(0, 48) || '새 대화';
}

function rowToSession(row: {
  id: string;
  workflow_id: string | null;
  title: string;
  summary: string | null;
  state_json: string;
  updated_at: string;
}): StoredChatSession {
  const payload = JSON.parse(row.state_json) as PersistedPayload;
  return {
    sessionId: row.id,
    workflowId: row.workflow_id ?? undefined,
    title: row.title,
    summary: row.summary ?? payload.summary,
    state: payload.state,
    updatedAt: row.updated_at,
  };
}

export function saveChatSession(
  db: AppDatabase,
  params: { state: InterviewState; summary?: string; workflowId?: string },
): StoredChatSession {
  const now = new Date().toISOString();
  const sessionId = params.state.sessionId || randomUUID();
  const state = { ...params.state, sessionId, workflowId: params.workflowId ?? params.state.workflowId };
  const title = sessionTitle(state);
  const payload: PersistedPayload = { state, summary: params.summary };
  const existing = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE chat_sessions SET workflow_id = ?, title = ?, summary = ?, state_json = ?, updated_at = ? WHERE id = ?',
    ).run(params.workflowId ?? state.workflowId ?? null, title, params.summary ?? null, JSON.stringify(payload), now, sessionId);
  } else {
    db.prepare(
      'INSERT INTO chat_sessions (id, workflow_id, title, summary, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      sessionId,
      params.workflowId ?? state.workflowId ?? null,
      title,
      params.summary ?? null,
      JSON.stringify(payload),
      now,
      now,
    );
  }

  return {
    sessionId,
    workflowId: params.workflowId ?? state.workflowId,
    title,
    summary: params.summary,
    state,
    updatedAt: now,
  };
}

export function getChatSession(db: AppDatabase, sessionId: string): StoredChatSession | null {
  const row = db
    .prepare('SELECT id, workflow_id, title, summary, state_json, updated_at FROM chat_sessions WHERE id = ?')
    .get(sessionId) as
    | {
        id: string;
        workflow_id: string | null;
        title: string;
        summary: string | null;
        state_json: string;
        updated_at: string;
      }
    | undefined;
  return row ? rowToSession(row) : null;
}

export function getChatSessionByWorkflowId(db: AppDatabase, workflowId: string): StoredChatSession | null {
  const row = db
    .prepare('SELECT id, workflow_id, title, summary, state_json, updated_at FROM chat_sessions WHERE workflow_id = ?')
    .get(workflowId) as
    | {
        id: string;
        workflow_id: string | null;
        title: string;
        summary: string | null;
        state_json: string;
        updated_at: string;
      }
    | undefined;
  return row ? rowToSession(row) : null;
}

export function linkChatSessionToWorkflow(db: AppDatabase, sessionId: string, workflowId: string): void {
  db.prepare('UPDATE chat_sessions SET workflow_id = ?, updated_at = ? WHERE id = ?').run(
    workflowId,
    new Date().toISOString(),
    sessionId,
  );
}

export function deleteChatSessionByWorkflowId(db: AppDatabase, workflowId: string): void {
  db.prepare('DELETE FROM chat_sessions WHERE workflow_id = ?').run(workflowId);
}

export function listChatSessions(db: AppDatabase, limit = 20): StoredChatSession[] {
  const rows = db
    .prepare(
      'SELECT id, workflow_id, title, summary, state_json, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT ?',
    )
    .all(limit) as Array<{
    id: string;
    workflow_id: string | null;
    title: string;
    summary: string | null;
    state_json: string;
    updated_at: string;
  }>;
  return rows.map(rowToSession);
}

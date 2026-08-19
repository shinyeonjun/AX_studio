import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { InterviewState } from '../../interview/interview-state.js';

export interface StoredChatSession {
  sessionId: string;
  skillId?: string;
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
  skill_id: string | null;
  title: string;
  summary: string | null;
  state_json: string;
  updated_at: string;
}): StoredChatSession {
  const payload = JSON.parse(row.state_json) as PersistedPayload;
  return {
    sessionId: row.id,
    skillId: row.skill_id ?? undefined,
    title: row.title,
    summary: row.summary ?? payload.summary,
    state: payload.state,
    updatedAt: row.updated_at,
  };
}

export function saveChatSession(
  db: AppDatabase,
  params: { state: InterviewState; summary?: string; skillId?: string },
): StoredChatSession {
  const now = new Date().toISOString();
  const sessionId = params.state.sessionId || randomUUID();
  const state = { ...params.state, sessionId, skillId: params.skillId ?? params.state.skillId };
  const title = sessionTitle(state);
  const payload: PersistedPayload = { state, summary: params.summary };
  const existing = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE chat_sessions SET skill_id = ?, title = ?, summary = ?, state_json = ?, updated_at = ? WHERE id = ?',
    ).run(params.skillId ?? state.skillId ?? null, title, params.summary ?? null, JSON.stringify(payload), now, sessionId);
  } else {
    db.prepare(
      'INSERT INTO chat_sessions (id, skill_id, title, summary, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      sessionId,
      params.skillId ?? state.skillId ?? null,
      title,
      params.summary ?? null,
      JSON.stringify(payload),
      now,
      now,
    );
  }

  return {
    sessionId,
    skillId: params.skillId ?? state.skillId,
    title,
    summary: params.summary,
    state,
    updatedAt: now,
  };
}

export function getChatSession(db: AppDatabase, sessionId: string): StoredChatSession | null {
  const row = db
    .prepare('SELECT id, skill_id, title, summary, state_json, updated_at FROM chat_sessions WHERE id = ?')
    .get(sessionId) as
    | {
        id: string;
        skill_id: string | null;
        title: string;
        summary: string | null;
        state_json: string;
        updated_at: string;
      }
    | undefined;
  return row ? rowToSession(row) : null;
}

export function getChatSessionBySkillId(db: AppDatabase, skillId: string): StoredChatSession | null {
  const row = db
    .prepare('SELECT id, skill_id, title, summary, state_json, updated_at FROM chat_sessions WHERE skill_id = ?')
    .get(skillId) as
    | {
        id: string;
        skill_id: string | null;
        title: string;
        summary: string | null;
        state_json: string;
        updated_at: string;
      }
    | undefined;
  return row ? rowToSession(row) : null;
}

export function linkChatSessionToSkill(db: AppDatabase, sessionId: string, skillId: string): void {
  db.prepare('UPDATE chat_sessions SET skill_id = ?, updated_at = ? WHERE id = ?').run(
    skillId,
    new Date().toISOString(),
    sessionId,
  );
}

export function deleteChatSessionBySkillId(db: AppDatabase, skillId: string): void {
  db.prepare('DELETE FROM chat_sessions WHERE skill_id = ?').run(skillId);
}

export function listChatSessions(db: AppDatabase, limit = 20): StoredChatSession[] {
  const rows = db
    .prepare(
      'SELECT id, skill_id, title, summary, state_json, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT ?',
    )
    .all(limit) as Array<{
    id: string;
    skill_id: string | null;
    title: string;
    summary: string | null;
    state_json: string;
    updated_at: string;
  }>;
  return rows.map(rowToSession);
}

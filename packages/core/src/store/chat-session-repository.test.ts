import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from './db.js';
import { WorkflowStore } from './workflow-store.js';
import { createInterviewState } from '../interview/session/state.js';

describe('chat session persistence boundary', () => {
  it('rejects an invalid interview state before writing JSON', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const state = createInterviewState('테스트', 'once');

    expect(() => store.saveChatSession({
      state: { ...state, workflow: { ...state.workflow, nodes: [{ type: 'invalid' }] } } as typeof state,
    })).toThrow();
    expect(store.listChatSessions()).toHaveLength(0);
  });

  it('deletes a stored interview chat session by id', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const state = createInterviewState('테스트', 'once');
    const saved = store.saveChatSession({ state });

    store.deleteChatSession(saved.sessionId);

    expect(store.getChatSession(saved.sessionId)).toBeNull();
    expect(store.listChatSessions()).toHaveLength(0);
  });

  it('rejects a persisted row whose wrapped state is malformed', async () => {
    const db = await createDatabaseAsync(':memory:');
    db.prepare(
      'INSERT INTO chat_sessions (id, workflow_id, title, summary, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('broken-session', null, '깨진 세션', null, JSON.stringify({ state: { sessionId: 'broken' } }), 'now', 'now');
    const store = new WorkflowStore(db);

    expect(() => store.getChatSession('broken-session')).toThrow(/상태가 손상되었습니다/);
  });

  it('keeps corrupt sessions visible as recoverable list metadata', async () => {
    const db = await createDatabaseAsync(':memory:');
    db.prepare(
      'INSERT INTO chat_sessions (id, workflow_id, title, summary, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('broken-session', null, '깨진 세션', null, JSON.stringify({ state: { sessionId: 'broken' } }), 'now', 'now');
    const store = new WorkflowStore(db);

    expect(store.listChatSessionSummaries()).toEqual([
      expect.objectContaining({
        sessionId: 'broken-session',
        title: '깨진 세션 (복구 필요)',
        corrupted: true,
      }),
    ]);
  });
});

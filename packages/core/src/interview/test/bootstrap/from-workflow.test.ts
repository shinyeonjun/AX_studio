import { describe, expect, it } from 'vitest';
import { csMailWorkflowFixture } from '../../../workflow/fixtures.js';
import { bootstrapInterviewFromWorkflow } from '../../bootstrap/from-workflow.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { saveChatSession, getChatSessionByWorkflowId } from '../../../store/repositories/chat-session-repository.js';

describe('bootstrapInterviewFromWorkflow', () => {
  it('creates resumable session from saved workflow', () => {
    const state = bootstrapInterviewFromWorkflow(csMailWorkflowFixture, 'workflow-1');
    expect(state.workflowId).toBe('workflow-1');
    expect(state.sessionId).toBeTruthy();
    expect(state.done).toBe(true);
    expect(state.workflow.nodes.length).toBeGreaterThan(0);
    expect(state.messages[0]?.content).toContain(csMailWorkflowFixture.name);
  });
});

describe('chat session repository', () => {
  it('persists and loads session by workflow id', async () => {
    const db = await createDatabaseAsync(':memory:');
    const state = bootstrapInterviewFromWorkflow(csMailWorkflowFixture, 'workflow-1');
    saveChatSession(db, { state, summary: '요약', workflowId: 'workflow-1' });
    const loaded = getChatSessionByWorkflowId(db, 'workflow-1');
    expect(loaded?.state.sessionId).toBe(state.sessionId);
    expect(loaded?.summary).toBe('요약');
    expect(loaded?.state.workflowId).toBe('workflow-1');
  });
});

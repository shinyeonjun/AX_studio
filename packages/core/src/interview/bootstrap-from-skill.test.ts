import { describe, expect, it } from 'vitest';
import { csMailSkillFixture } from '../skill/fixtures.js';
import { bootstrapInterviewFromSkill } from './bootstrap-from-skill.js';
import { createDatabaseAsync } from '../store/db.js';
import { saveChatSession, getChatSessionBySkillId } from '../store/repositories/chat-session-repository.js';

describe('bootstrapInterviewFromSkill', () => {
  it('creates resumable session from saved skill', () => {
    const state = bootstrapInterviewFromSkill(csMailSkillFixture, 'skill-1');
    expect(state.skillId).toBe('skill-1');
    expect(state.sessionId).toBeTruthy();
    expect(state.done).toBe(true);
    expect(state.workflow.nodes.length).toBeGreaterThan(0);
    expect(state.messages[0]?.content).toContain(csMailSkillFixture.name);
  });
});

describe('chat session repository', () => {
  it('persists and loads session by skill id', async () => {
    const db = await createDatabaseAsync(':memory:');
    const state = bootstrapInterviewFromSkill(csMailSkillFixture, 'skill-1');
    saveChatSession(db, { state, summary: '요약', skillId: 'skill-1' });
    const loaded = getChatSessionBySkillId(db, 'skill-1');
    expect(loaded?.state.sessionId).toBe(state.sessionId);
    expect(loaded?.summary).toBe('요약');
    expect(loaded?.state.skillId).toBe('skill-1');
  });
});

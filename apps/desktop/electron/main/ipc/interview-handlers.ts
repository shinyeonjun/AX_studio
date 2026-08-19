import { ipcMain } from 'electron';
import {
  applyAnswer,
  bootstrapInterviewFromSkill,
  explainExecution,
  proposeSkillRevision,
  startInterview,
  summarizeSkill,
  type InterviewState,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';

async function persistSession(state: InterviewState, summary?: string) {
  getCore().store.saveChatSession({ state, summary, skillId: state.skillId });
}

export function registerInterviewHandlers() {
  ipcMain.handle('ax:startInterview', async (_e, instruction: string) => {
    const core = getCore();
    const state = await startInterview(instruction, {
      harness: core.agentHarness,
      connectedConnectors: connectedConnectorIds(core.store),
      onProgress: (event) => _e.sender.send('ax:agent-progress', event),
    });
    await persistSession(state);
    return state;
  });

  ipcMain.handle('ax:applyAnswer', async (_e, state, answer: string) => {
    const core = getCore();
    const interviewState = state as InterviewState;
    const next = await applyAnswer(interviewState, answer, {
      harness: core.agentHarness,
      connectedConnectors: connectedConnectorIds(core.store),
      onProgress: (event) => _e.sender.send('ax:agent-progress', event),
    });
    const summary = next.done && next.draft ? summarizeSkill(next.draft) : undefined;
    if (next.skillId && next.draft && next.done) {
      const existing = core.store.getSkill(next.skillId);
      if (existing) {
        core.store.saveSkill({ ...existing, ...next.draft, id: next.skillId });
      }
    }
    await persistSession(next, summary);
    return next;
  });

  ipcMain.handle('ax:loadSkillChat', async (_e, skillId: string) => {
    const core = getCore();
    const existing = core.store.getChatSessionBySkillId(skillId);
    if (existing) {
      return { state: existing.state, summary: existing.summary, title: existing.title };
    }
    const ir = core.store.getSkill(skillId);
    if (!ir) throw new Error('Skill not found');
    const state = bootstrapInterviewFromSkill(ir, skillId);
    const summary = summarizeSkill(state.draft);
    core.store.saveChatSession({ state, summary, skillId });
    return { state, summary, title: ir.name };
  });

  ipcMain.handle('ax:saveChatSession', async (_e, state: InterviewState, summary?: string, skillId?: string) => {
    getCore().store.saveChatSession({ state, summary, skillId });
    return { ok: true };
  });

  ipcMain.handle('ax:summarize', async (_e, ir) => summarizeSkill(ir));
  ipcMain.handle('ax:explain', async (_e, question: string) => explainExecution(getCore().store, question));
  ipcMain.handle('ax:proposeRevision', async (_e, skillId: string, instruction: string) => {
    const core = getCore();
    const ir = core.store.getSkill(skillId);
    return proposeSkillRevision(ir ?? {}, instruction, { harness: core.agentHarness });
  });
}

import { ipcMain } from 'electron';
import {
  applyAnswer,
  explainExecution,
  proposeSkillRevision,
  startInterview,
  summarizeSkill,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';

export function registerInterviewHandlers() {
  ipcMain.handle('ax:startInterview', async (_e, instruction: string) => {
    const core = getCore();
    return startInterview(instruction, {
      harness: core.agentHarness,
      connectedConnectors: connectedConnectorIds(core.store),
      onProgress: (event) => _e.sender.send('ax:agent-progress', event),
    });
  });
  ipcMain.handle('ax:applyAnswer', async (_e, state, answer: string) => {
    const core = getCore();
    return applyAnswer(state, answer, {
      harness: core.agentHarness,
      connectedConnectors: connectedConnectorIds(core.store),
      onProgress: (event) => _e.sender.send('ax:agent-progress', event),
    });
  });
  ipcMain.handle('ax:summarize', async (_e, ir) => summarizeSkill(ir));
  ipcMain.handle('ax:explain', async (_e, question: string) => explainExecution(getCore().store, question));
  ipcMain.handle('ax:proposeRevision', async (_e, skillId: string, instruction: string) => {
    const core = getCore();
    const ir = core.store.getSkill(skillId);
    return proposeSkillRevision(ir ?? {}, instruction, { harness: core.agentHarness });
  });
}

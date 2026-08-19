import { ipcMain } from 'electron';
import {
  applyAnswer,
  bootstrapInterviewFromWorkflow,
  buildDesignToolContext,
  explainExecution,
  proposeWorkflowRevision,
  startInterview,
  summarizeWorkflow,
  type InterviewState,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';

async function persistSession(state: InterviewState, summary?: string) {
  getCore().store.saveChatSession({ state, summary, workflowId: state.workflowId });
}

function interviewRunOptions(core: ReturnType<typeof getCore>, sender: Electron.WebContents) {
  const connections = core.store.getConnections();
  const connected = connectedConnectorIds(core.store);
  return {
    harness: core.agentHarness,
    connectedConnectors: connected,
    designToolContext: buildDesignToolContext(connections, connected),
    onProgress: (event: { message: string }) => sender.send('ax:agent-progress', event),
  };
}

export function registerInterviewHandlers() {
  ipcMain.handle('ax:startInterview', async (_e, instruction: string) => {
    const core = getCore();
    const state = await startInterview(instruction, interviewRunOptions(core, _e.sender));
    await persistSession(state);
    return state;
  });

  ipcMain.handle('ax:applyAnswer', async (_e, state, answer: string) => {
    const core = getCore();
    const interviewState = state as InterviewState;
    const next = await applyAnswer(interviewState, answer, interviewRunOptions(core, _e.sender));
    const summary = next.done && next.draft ? summarizeWorkflow(next.draft) : undefined;
    if (next.workflowId && next.draft && next.done) {
      const existing = core.store.getWorkflow(next.workflowId);
      if (existing) {
        core.store.saveWorkflow({ ...existing, ...next.draft, id: next.workflowId });
      }
    }
    await persistSession(next, summary);
    return next;
  });

  ipcMain.handle('ax:loadWorkChat', async (_e, workflowId: string) => {
    const core = getCore();
    const existing = core.store.getChatSessionByWorkflowId(workflowId);
    if (existing) {
      return { state: existing.state, summary: existing.summary, title: existing.title };
    }
    const ir = core.store.getWorkflow(workflowId);
    if (!ir) throw new Error('Workflow not found');
    const state = bootstrapInterviewFromWorkflow(ir, workflowId);
    const summary = summarizeWorkflow(state.draft);
    core.store.saveChatSession({ state, summary, workflowId });
    return { state, summary, title: ir.name };
  });

  ipcMain.handle('ax:saveChatSession', async (_e, state: InterviewState, summary?: string, workflowId?: string) => {
    getCore().store.saveChatSession({ state, summary, workflowId });
    return { ok: true };
  });

  ipcMain.handle('ax:summarize', async (_e, ir) => summarizeWorkflow(ir));
  ipcMain.handle('ax:explain', async (_e, question: string) => explainExecution(getCore().store, question));
  ipcMain.handle('ax:proposeRevision', async (_e, workflowId: string, instruction: string) => {
    const core = getCore();
    const ir = core.store.getWorkflow(workflowId);
    return proposeWorkflowRevision(ir ?? {}, instruction, { harness: core.agentHarness });
  });
}

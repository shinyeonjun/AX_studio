import { ipcMain } from 'electron';
import {
  applyAnswer,
  applyInterviewPatch,
  bootstrapInterviewFromWorkflow,
  buildDesignToolContext,
  explainExecution,
  proposeWorkflowRevision,
  startInterview,
  summarizeWorkflow,
  hydrateInterviewState,
  parseInterviewState,
  parseWorkflowIR,
  InterviewPatchSchema,
  type InterviewPatch,
  type InterviewState,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';

function sanitizeInterviewState(state: unknown): InterviewState {
  return hydrateInterviewState(parseInterviewState(state));
}

async function persistSession(state: InterviewState, summary?: string) {
  getCore().store.saveChatSession({ state, summary, workflowId: state.workflowId });
}

function interviewRunOptions(core: ReturnType<typeof getCore>) {
  const connections = core.store.getConnections();
  const connected = connectedConnectorIds(core.store);
  return {
    harness: core.agentHarness,
    connectedConnectors: connected,
    designToolContext: buildDesignToolContext(connections, connected),
  };
}

export function registerInterviewHandlers() {
  ipcMain.handle('ax:startInterview', async (_e, instruction: string, workScope?: 'once' | 'recurring') => {
    const core = getCore();
    if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('업무 지시를 입력해 주세요.');
    if (workScope !== 'once' && workScope !== 'recurring') throw new Error('업무 범위를 일회성 또는 다회성으로 선택해 주세요.');
    try {
      const state = await startInterview(instruction, interviewRunOptions(core), workScope);
      await persistSession(state);
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : String(error);
      throw new Error(
        message && message !== '{' ? message : '인터뷰 AI 호출에 실패했습니다. AI 연결과 모델을 확인하세요.',
      );
    }
  });

  ipcMain.handle('ax:applyAnswer', async (_e, state, answer: string) => {
    const core = getCore();
    const interviewState = parseInterviewState(state);
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('답변을 입력해 주세요.');
    const next = await applyAnswer(interviewState, answer, interviewRunOptions(core));
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

  ipcMain.handle('ax:applyInterviewPatch', async (_e, state, patch: InterviewPatch) => {
    const core = getCore();
    const next = applyInterviewPatch(
      parseInterviewState(state),
      InterviewPatchSchema.parse(patch),
      interviewRunOptions(core),
    );
    await persistSession(next);
    return next;
  });

  ipcMain.handle('ax:loadWorkChat', async (_e, workflowId: string) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    const existing = core.store.getChatSessionByWorkflowId(workflowId);
    if (existing) {
      const state = sanitizeInterviewState(existing.state);
      return { state, summary: existing.summary, title: existing.title };
    }
    const ir = core.store.getWorkflow(workflowId);
    if (!ir) throw new Error('Workflow not found');
    const state = bootstrapInterviewFromWorkflow(ir, workflowId);
    const summary = summarizeWorkflow(state.draft);
    core.store.saveChatSession({ state, summary, workflowId });
    return { state, summary, title: ir.name };
  });

  ipcMain.handle('ax:saveChatSession', async (_e, state: InterviewState, summary?: string, workflowId?: string) => {
    getCore().store.saveChatSession({ state: parseInterviewState(state), summary, workflowId });
    return { ok: true };
  });

  ipcMain.handle('ax:summarize', async (_e, ir) => summarizeWorkflow(parseWorkflowIR(ir)));
  ipcMain.handle('ax:explain', async (_e, question: unknown) => {
    if (typeof question !== 'string' || !question.trim()) throw new Error('설명할 질문을 입력해 주세요.');
    return explainExecution(getCore().store, question);
  });
  ipcMain.handle('ax:proposeRevision', async (_e, workflowId: string, instruction: string) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('수정 지시를 입력해 주세요.');
    const ir = core.store.getWorkflow(workflowId);
    if (!ir) throw new Error('Workflow not found');
    return proposeWorkflowRevision(ir, instruction, { harness: core.agentHarness });
  });
}

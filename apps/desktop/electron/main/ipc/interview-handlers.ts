import { ipcHandle } from './ipc-handle.js';
import {
  applyAnswer,
  bootstrapInterviewFromWorkflow,
  explainExecution,
  runWorkspaceChat,
  startInterview,
  summarizeWorkflow,
  hydrateInterviewState,
  parseInterviewState,
  parseWorkflowIR,
  type InterviewState,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';
import { boundedText, normalizeChatMessages, requireLastUserMessage } from './chat-boundary.js';
import { buildDesktopDesignToolContext } from './design-tool-context.js';

function parseBoundedInterviewState(state: unknown): InterviewState {
  // Check the raw message array before parsing the larger workflow payload so
  // renderer-controlled state cannot bypass the same IPC size contract as
  // workspace chat.
  if (state && typeof state === 'object' && !Array.isArray(state) && 'messages' in state) {
    normalizeChatMessages((state as { messages?: unknown }).messages);
  }
  const parsed = parseInterviewState(state);
  return { ...parsed, messages: normalizeChatMessages(parsed.messages) };
}

function sanitizeInterviewState(state: unknown): InterviewState {
  return hydrateInterviewState(parseBoundedInterviewState(state));
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
    designToolContext: buildDesktopDesignToolContext(core, connections, connected, undefined, 'authoring'),
  };
}

export function registerInterviewHandlers() {
  ipcHandle('ax:startInterview', async (_e, instruction: string, workScope?: 'once' | 'recurring') => {
    const core = getCore();
    boundedText(instruction, '업무 지시');
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

  ipcHandle('ax:applyAnswer', async (_e, state, answer: string) => {
    const core = getCore();
    const interviewState = parseBoundedInterviewState(state);
    boundedText(answer, '답변');
    const next = await applyAnswer(interviewState, answer, interviewRunOptions(core));
    const summary = next.done && next.draft ? summarizeWorkflow(next.draft) : undefined;
    await persistSession(next, summary);
    return next;
  });

  ipcHandle('ax:loadWorkChat', async (_e, workflowId: string) => {
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

  ipcHandle('ax:loadInterviewChat', async (_e, sessionId: string) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('세션 id가 필요합니다.');
    const session = getCore().store.getChatSession(sessionId.trim());
    if (!session) throw new Error('대화 세션을 찾을 수 없습니다.');
    const state = sanitizeInterviewState(session.state);
    return { state, summary: session.summary, title: session.title };
  });

  ipcHandle('ax:saveChatSession', async (_e, state: InterviewState, summary?: string, workflowId?: string) => {
    const parsed = parseBoundedInterviewState(state);
    if (summary !== undefined) boundedText(summary, '대화 요약');
    if (workflowId !== undefined) boundedText(workflowId, 'Workflow id', 500);
    getCore().store.saveChatSession({
      state: parsed,
      summary,
      workflowId: workflowId ?? parsed.workflowId,
    });
    return { ok: true };
  });

  ipcHandle('ax:summarize', async (_e, ir) => summarizeWorkflow(parseWorkflowIR(ir)));

  ipcHandle('ax:sendChat', async (
    event,
    messages: unknown,
  ) => {
    const core = getCore();
    const normalizedMessages = normalizeChatMessages(messages);
    if (normalizedMessages.length === 0) {
      throw new Error('대화 기록이 필요합니다.');
    }
    const userMessage = requireLastUserMessage(normalizedMessages);
    const history = normalizedMessages.slice(0, -1);
    try {
      const reply = await runWorkspaceChat({
        harness: core.agentHarness,
        designToolContext: buildDesktopDesignToolContext(
          core,
          core.store.getConnections(),
          connectedConnectorIds(core.store),
        ),
        connectedConnectors: connectedConnectorIds(core.store),
        messages: history,
        userMessage,
        onProgress: ({ message }) => {
          event.sender.send('ax:chat-progress', { message });
        },
      });
      return { role: 'assistant' as const, content: reply };
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : String(error);
      throw new Error(message && message !== '{' ? message : '채팅 AI 호출에 실패했습니다. AI 연결을 확인하세요.');
    }
  });

  ipcHandle('ax:listChatSessions', async () => {
    const core = getCore();
    const workspace = core.store.listWorkspaceChats(50).map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      kind: 'workspace' as const,
      corrupted: chat.corrupted,
    }));
    const interviews = core.store.listChatSessionSummaries(50).map((session) => ({
      id: session.sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
      kind: 'interview' as const,
      workflowId: session.workflowId,
      corrupted: session.corrupted,
    }));
    return [...workspace, ...interviews].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

  ipcHandle('ax:saveWorkspaceChat', async (_e, id: string | undefined, messages: unknown) => {
    const core = getCore();
    if (id !== undefined && typeof id !== 'string') throw new Error('대화 id 형식이 올바르지 않습니다.');
    return core.store.saveWorkspaceChat({ id, messages: normalizeChatMessages(messages) });
  });

  ipcHandle('ax:loadWorkspaceChat', async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('대화 id가 필요합니다.');
    const chat = getCore().store.getWorkspaceChat(id);
    if (!chat) throw new Error('대화를 찾을 수 없습니다.');
    return chat;
  });

  ipcHandle('ax:deleteWorkspaceChat', async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('대화 id가 필요합니다.');
    getCore().store.deleteWorkspaceChat(id);
    return { ok: true };
  });

  ipcHandle('ax:deleteInterviewChatSession', async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('세션 id가 필요합니다.');
    getCore().store.deleteChatSession(id.trim());
    return { ok: true };
  });

  ipcHandle('ax:explain', async (_e, question: unknown) => {
    if (typeof question !== 'string' || !question.trim()) throw new Error('설명할 질문을 입력해 주세요.');
    return explainExecution(getCore().store, question);
  });
}

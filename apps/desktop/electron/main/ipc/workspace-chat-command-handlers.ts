import {
  appendAppLog,
  explainExecution,
  runAxCommandChat,
  AX_COMMAND_CHAT_TIMEOUT_MS,
} from '@ax-studio/core';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';
import { normalizeChatMessages, requireLastUserMessage } from './chat-boundary.js';
import { buildDesktopDesignToolContext } from './design-tool-context.js';
import {
  cancelWorkspaceChat,
  registerWorkspaceChat,
  releaseWorkspaceChat,
} from '../workspace-chat-registry.js';
import { runE2EChat } from '../e2e-test-seam.js';

function workflowIdsChanged(result: { command: string; data?: unknown }): {
  changed?: string;
  removed?: string;
} {
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const workflowId = (result.data as { workflowId?: unknown }).workflowId;
    if (typeof workflowId === 'string' && workflowId.trim()) {
      if (result.command === 'workflow.delete') return { removed: workflowId };
      if (result.command === 'workflow.create' || result.command === 'workflow.update' || result.command === 'job.commit') {
        return { changed: workflowId };
      }
    }
  }
  return {};
}

/**
 * A context mutation is authorized only by a host-rendered confirmation action
 * from an earlier assistant message. Matching the stored action value keeps a
 * normal chat sentence from becoming an implicit persistence permission.
 */
function isContextConfirmation(
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    presentations?: import('@ax-studio/core').AxUiPresentation[];
  }>,
  userMessage: string,
): boolean {
  return messages.slice(0, -1).some((message) =>
    message.role === 'assistant' && message.presentations?.some((presentation) =>
      presentation.actions.some((action) => action.purpose === 'confirm_context' && action.value === userMessage),
    ),
  );
}

function isJobConfirmation(
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    presentations?: import('@ax-studio/core').AxUiPresentation[];
  }>,
  userMessage: string,
): boolean {
  return messages.slice(0, -1).some((message) =>
    message.role === 'assistant' && message.presentations?.some((presentation) =>
      presentation.actions.some((action) => action.purpose === 'confirm_job' && action.value === userMessage),
    ),
  );
}

export function registerWorkspaceChatCommandHandlers() {
  ipcHandle('ax:sendCommandChat', async (
    event,
    messages: unknown,
    requestId?: unknown,
    workflowId?: unknown,
    workspaceSessionId?: unknown,
  ) => {
    const core = getCore();
    const normalizedMessages = normalizeChatMessages(messages);
    if (normalizedMessages.length === 0) throw new Error('대화 기록이 필요합니다.');
    const userMessage = requireLastUserMessage(normalizedMessages);
    if (workflowId !== undefined && (typeof workflowId !== 'string' || !workflowId.trim())) {
      throw new Error('workflow id 형식이 올바르지 않습니다.');
    }
    if (workspaceSessionId !== undefined &&
      (typeof workspaceSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceSessionId.trim()))) {
      throw new Error('대화 세션 id 형식이 올바르지 않습니다.');
    }
    const safeWorkspaceSessionId = typeof workspaceSessionId === 'string'
      ? workspaceSessionId.trim()
      : undefined;
    const requestedWorkflowId = typeof workflowId === 'string' ? workflowId.trim() : undefined;
    const mappedWorkflowId = safeWorkspaceSessionId
      ? core.store.getWorkspaceChat(safeWorkspaceSessionId)?.workflowId
      : undefined;
    const effectiveWorkflowId = requestedWorkflowId || mappedWorkflowId;
    const contextUpdateConfirmed = isContextConfirmation(normalizedMessages, userMessage);
    const jobCommitConfirmed = isJobConfirmation(normalizedMessages, userMessage);
    // Rendering metadata belongs to the host transcript, not the provider prompt.
    const history = normalizedMessages.slice(0, -1).map(({ role, content }) => ({ role, content }));
    const chatRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : `command-chat-${Date.now()}`;
    const controller = registerWorkspaceChat(chatRequestId);
    const changedWorkflowIds = new Set<string>();
    const removedWorkflowIds = new Set<string>();
    let inputRequests: import('@ax-studio/core').AxInputRequest[] = [];
    const presentations: import('@ax-studio/core').AxUiPresentation[] = [];
    try {
      if (process.env.AX_E2E === '1' && process.env.AX_E2E_FAKE_AGENT === '1') {
        const reply = await runE2EChat({
          core,
          userMessage,
          workspaceSessionId: safeWorkspaceSessionId,
        });
        return {
          role: 'assistant' as const,
          content: reply.content,
          requestId: chatRequestId,
          changedWorkflowIds: reply.changedWorkflowIds,
          removedWorkflowIds: reply.removedWorkflowIds,
          inputRequests: reply.inputRequests,
          presentations: reply.presentations,
        };
      }
      const reply = await runAxCommandChat({
        harness: core.agentHarness,
        commandService: core.commandService,
        connectedConnectors: connectedConnectorIds(core.store),
        messages: history,
        userMessage,
        currentWorkflowId: effectiveWorkflowId,
        sessionMemo: safeWorkspaceSessionId
          ? core.store.getWorkspaceChatMemo(safeWorkspaceSessionId)
          : {},
        workflowPolicy: effectiveWorkflowId
          ? core.store.getWorkflowPolicy(effectiveWorkflowId)
          : {},
        allowContextUpdate: contextUpdateConfirmed,
        allowJobCommit: jobCommitConfirmed,
        workspaceSessionId: safeWorkspaceSessionId,
        workspaceSources: safeWorkspaceSessionId
          ? core.workspaceSources.list(safeWorkspaceSessionId)
          : [],
        designToolContextFactory: () => buildDesktopDesignToolContext(
          core,
          core.store.getConnections(),
          connectedConnectorIds(core.store),
        ),
        abortSignal: controller.signal,
        timeoutMs: AX_COMMAND_CHAT_TIMEOUT_MS,
        onCommandResult: (result) => {
          const ids = workflowIdsChanged(result);
          if (ids.changed) changedWorkflowIds.add(ids.changed);
          if (ids.removed) removedWorkflowIds.add(ids.removed);
        },
        onInputRequests: (requests) => {
          inputRequests = requests;
        },
        onPresentation: (presentation) => {
          presentations.push(presentation);
        },
        onProgress: ({ message }) => {
          event.sender.send('ax:chat-progress', { message, requestId: chatRequestId });
        },
      });
      return {
        role: 'assistant' as const,
        content: reply,
        requestId: chatRequestId,
        changedWorkflowIds: [...changedWorkflowIds],
        removedWorkflowIds: [...removedWorkflowIds],
        inputRequests,
        presentations,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : String(error);
      appendAppLog('error', message && message !== '{' ? message : 'command chat failed', {
        event: 'desktop_command_chat',
        requestId: chatRequestId,
      });
      throw new Error(message && message !== '{' ? message : '명령형 채팅 AI 호출에 실패했습니다. AI 연결을 확인하세요.');
    } finally {
      releaseWorkspaceChat(chatRequestId, controller);
    }
  });

  ipcHandle('ax:cancelChat', async (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId.trim()) return { ok: false };
    return { ok: cancelWorkspaceChat(requestId.trim()) };
  });

  ipcHandle('ax:explain', async (_event, question: unknown) => {
    if (typeof question !== 'string' || !question.trim()) throw new Error('설명할 질문을 입력해 주세요.');
    return explainExecution(getCore().store, question);
  });
}

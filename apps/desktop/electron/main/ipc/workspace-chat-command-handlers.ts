import {
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

function workflowIdsChanged(result: { command: string; data?: unknown }): {
  changed?: string;
  removed?: string;
} {
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const workflowId = (result.data as { workflowId?: unknown }).workflowId;
    if (typeof workflowId === 'string' && workflowId.trim()) {
      if (result.command === 'workflow.delete') return { removed: workflowId };
      if (result.command === 'workflow.create' || result.command === 'workflow.update') {
        return { changed: workflowId };
      }
    }
  }
  return {};
}

export function registerWorkspaceChatCommandHandlers() {
  ipcHandle('ax:sendCommandChat', async (
    event,
    messages: unknown,
    requestId?: unknown,
    workflowId?: unknown,
  ) => {
    const core = getCore();
    const normalizedMessages = normalizeChatMessages(messages);
    if (normalizedMessages.length === 0) throw new Error('대화 기록이 필요합니다.');
    const userMessage = requireLastUserMessage(normalizedMessages);
    // Rendering metadata belongs to the host transcript, not the provider prompt.
    const history = normalizedMessages.slice(0, -1).map(({ role, content }) => ({ role, content }));
    if (workflowId !== undefined && (typeof workflowId !== 'string' || !workflowId.trim())) {
      throw new Error('workflow id 형식이 올바르지 않습니다.');
    }
    const chatRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : `command-chat-${Date.now()}`;
    const controller = registerWorkspaceChat(chatRequestId);
    const changedWorkflowIds = new Set<string>();
    const removedWorkflowIds = new Set<string>();
    let inputRequests: import('@ax-studio/core').AxInputRequest[] = [];
    const presentations: import('@ax-studio/core').AxUiPresentation[] = [];
    try {
      const reply = await runAxCommandChat({
        harness: core.agentHarness,
        commandService: core.commandService,
        connectedConnectors: connectedConnectorIds(core.store),
        messages: history,
        userMessage,
        currentWorkflowId: typeof workflowId === 'string' ? workflowId.trim() : undefined,
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
      throw new Error(message && message !== '{' ? message : '명령형 채팅 AI 호출에 실패했습니다. AI 연결을 확인하세요.');
    } finally {
      releaseWorkspaceChat(chatRequestId);
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

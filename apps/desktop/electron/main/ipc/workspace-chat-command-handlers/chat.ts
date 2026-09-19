import {
  appendAppLog,
  AX_COMMAND_CHAT_TIMEOUT_MS,
  buildJevReadOperationHints,
  httpEndpointsFromConnections,
  runAxCommandChat,
} from '@ax-studio/core';
import { performance } from 'node:perf_hooks';
import type { AxInputRequest, AxUiPresentation } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { connectedConnectorIds } from '../shared.js';
import { boundedText, selectChatContext, selectMessagesThroughUserMessage } from '../chat-boundary.js';
import { buildDesktopDesignToolContext } from '../design-tool-context.js';
import {
  registerWorkspaceChat,
  releaseWorkspaceChat,
} from '../../workspace-chat-registry.js';
import { runE2EChat } from '../../e2e-test-seam.js';
import { isContextConfirmation, isJobConfirmation, workflowIdsChanged } from './helpers.js';

export function registerWorkspaceChatMessageHandler() {
  ipcHandle('ax:sendCommandChat', async (
    event,
    userMessageInput: unknown,
    requestId?: unknown,
    workflowId?: unknown,
    workspaceSessionId?: unknown,
  ) => {
    const core = getCore();
    const startedAt = performance.now();
    if (workflowId !== undefined && (typeof workflowId !== 'string' || !workflowId.trim())) {
      throw new Error('workflow id 형식이 올바르지 않습니다.');
    }
    if (typeof workspaceSessionId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceSessionId.trim())) {
      throw new Error('대화 세션 id 형식이 올바르지 않습니다.');
    }
    const safeWorkspaceSessionId = workspaceSessionId.trim();
    const storedChat = core.store.getWorkspaceChat(safeWorkspaceSessionId);
    if (!storedChat) throw new Error('대화를 찾을 수 없습니다.');
    const userMessage = boundedText(userMessageInput, '사용자 메시지').trim();
    const requestMessages = selectMessagesThroughUserMessage(storedChat.messages, userMessage);
    const requestedWorkflowId = typeof workflowId === 'string' ? workflowId.trim() : undefined;
    const mappedWorkflowId = storedChat.workflowId;
    const effectiveWorkflowId = requestedWorkflowId || mappedWorkflowId;
    const contextUpdateConfirmed = isContextConfirmation(requestMessages, userMessage);
    const jobCommitConfirmed = isJobConfirmation(requestMessages, userMessage);
    // Rendering metadata belongs to the host transcript, not the provider prompt.
    const history = selectChatContext(requestMessages).slice(0, -1).map(({ role, content }) => ({ role, content }));
    const chatRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : `command-chat-${Date.now()}`;
    const historyChars = history.reduce((total, message) => total + message.content.length, 0);
    const controller = registerWorkspaceChat(chatRequestId, safeWorkspaceSessionId);
    const changedWorkflowIds = new Set<string>();
    const removedWorkflowIds = new Set<string>();
    let inputRequests: AxInputRequest[] = [];
    const presentations: AxUiPresentation[] = [];
    let outcome: 'success' | 'failed' = 'failed';
    try {
      if (process.env.AX_E2E === '1' && process.env.AX_E2E_FAKE_AGENT === '1') {
        const reply = await runE2EChat({
          core,
          userMessage,
          workspaceSessionId: safeWorkspaceSessionId,
        });
        outcome = 'success';
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
      const connections = core.store.getConnections();
      const httpEndpoints = httpEndpointsFromConnections(connections).map((endpoint) => ({
        id: endpoint.id,
        ...(endpoint.label ? { label: endpoint.label } : {}),
        usable: endpoint.auth?.type === undefined || endpoint.auth.type === 'none' || endpoint.authStored === true,
      }));
      const reply = await runAxCommandChat({
        harness: core.agentHarness,
        commandService: core.commandService,
        decisionEngine: core.decisionEngine,
        connectedConnectors: connectedConnectorIds(core.store),
        httpEndpoints,
        readOperationHints: buildJevReadOperationHints(connections, userMessage),
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
      outcome = 'success';
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
      appendAppLog('info', 'desktop command chat completed', {
        event: 'desktop_command_chat_completed',
        requestId: chatRequestId,
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
        messageCount: requestMessages.length,
        historyMessages: history.length,
        historyChars,
        userMessageChars: userMessage.length,
        hasWorkspaceSession: Boolean(safeWorkspaceSessionId),
      });
      releaseWorkspaceChat(chatRequestId, controller);
    }
  });
}

import {
  appendAppLog,
  AX_COMMAND_CHAT_TIMEOUT_MS,
  buildJevReadOperationIndex,
  connectedConnectorIds,
  httpEndpointsFromConnections,
  aiDecisionOutputPorts,
  resolveCapability,
  runAxCommandChat,
  stepOutputPorts,
  triggerOutputPorts,
  type JevReadOperationIndex,
  type TableArtifact,
  WorkspaceChatReadResultSchema,
} from '@ax-studio/core';
import { app } from 'electron';
import { performance } from 'node:perf_hooks';
import type { AxCommand, AxInputRequest, AxUiPresentation } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import {
  boundedText,
  commandInputContinuation,
  selectChatContext,
  selectMessagesThroughUserMessage,
} from '../chat-boundary.js';
import { buildDesktopDesignToolContext } from '../design-tool-context.js';
import {
  registerWorkspaceChat,
  releaseWorkspaceChat,
} from '../../workspace-chat-registry.js';
import { runE2EChat } from '../../e2e-test-seam.js';
import {
  claimPendingCommand,
  bindPendingCommandInputRequests,
  clearPendingCommand,
  finishClaimedPendingCommand,
  rememberPendingCommand,
  replaceClaimedPendingCommand,
  type PendingCommandInputValue,
} from './pending-command.js';
import { contextUpdateConfirmation as findContextUpdateConfirmation, isJobConfirmation, workflowIdsChanged } from './helpers.js';

type JevOperationConnections = Parameters<typeof buildJevReadOperationIndex>[0];

const jevOperationIndexCache = new WeakMap<object, {
  revision: number;
  index: JevReadOperationIndex;
}>();

function selectJevReadOperations(
  store: object,
  revision: number | undefined,
  connections: JevOperationConnections,
  userMessage: string,
) {
  const cached = revision === undefined ? undefined : jevOperationIndexCache.get(store);
  if (!cached || cached.revision !== revision) {
    const index = buildJevReadOperationIndex(connections);
    if (revision !== undefined) jevOperationIndexCache.set(store, { revision, index });
    return index.select(userMessage);
  }
  return cached.index.select(userMessage);
}

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
    const pendingInput = commandInputContinuation(requestMessages);
    const requestedWorkflowId = typeof workflowId === 'string' ? workflowId.trim() : undefined;
    const mappedWorkflowId = storedChat.workflowId;
    const effectiveWorkflowId = requestedWorkflowId || mappedWorkflowId;
    const currentWorkflow = effectiveWorkflowId ? core.store.getWorkflow(effectiveWorkflowId) : undefined;
    const currentWorkflowVersion = currentWorkflow?.version;
    const currentWorkflowSteps = currentWorkflow?.steps.map((step) => ({
      id: step.id,
      type: step.type,
      label: step.type === 'action'
        ? `${step.connector} / ${step.action}`
        : step.type === 'ai_decision'
          ? `AI 판단 / ${step.goal}`
          : step.type === 'human_approval'
            ? `승인 / ${step.reason}`
            : '조건 분기',
    }));
    const currentWorkflowOutputs = currentWorkflow ? [
      ...triggerOutputPorts(currentWorkflow.trigger).map(({ from, port, type }) => ({
        from,
        output: port,
        type,
        capabilityId: `workflow.trigger.${currentWorkflow.trigger?.type ?? 'unknown'}`,
      })),
      ...currentWorkflow.steps.flatMap((step) => {
        const outputs = step.type === 'action'
          ? stepOutputPorts(step)
          : step.type === 'ai_decision'
            ? aiDecisionOutputPorts(step)
            : [];
        const capabilityId = step.type === 'action'
          ? resolveCapability(step.connector, step.action)?.id ?? 'workflow.action'
          : 'workflow.ai_decision';
        return outputs.map(({ from, port, type }) => ({ from, output: port, type, capabilityId }));
      }),
    ] : undefined;
    const confirmedContextUpdate = findContextUpdateConfirmation(requestMessages, userMessage);
    const jobCommitConfirmationToken = isJobConfirmation(requestMessages, userMessage);
    const jobCommitConfirmed = Boolean(jobCommitConfirmationToken);
    // Rendering metadata belongs to the host transcript, not the provider prompt.
    const history = selectChatContext(requestMessages).slice(0, -1).map(({ role, content }) => ({ role, content }));
    const immediatelyPreviousAssistant = requestMessages.at(-2);
    const previousReadResult = immediatelyPreviousAssistant?.role === 'assistant'
      ? immediatelyPreviousAssistant.readResult
      : undefined;
    const chatRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : `command-chat-${Date.now()}`;
    const historyChars = history.reduce((total, message) => total + message.content.length, 0);
    const controller = registerWorkspaceChat(chatRequestId, safeWorkspaceSessionId);
    const changedWorkflowIds = new Set<string>();
    const removedWorkflowIds = new Set<string>();
    let inputRequests: AxInputRequest[] = [];
    const presentations: AxUiPresentation[] = [];
    let readResult: TableArtifact | undefined;
    let pendingCommandClaim: { token: string; command: AxCommand; inputValues: PendingCommandInputValue[] } | undefined;
    let pendingInputRequestToken: string | undefined;
    let outcome: 'success' | 'failed' = 'failed';
    try {
      if (pendingInput) {
        const claim = claimPendingCommand(
          safeWorkspaceSessionId,
          pendingInput.request,
          pendingInput.requestIds,
          pendingInput.values,
        );
        if (claim.kind !== 'claimed') {
          outcome = 'success';
          const content = claim.kind === 'in_progress'
            ? '이 실행안은 이미 이어서 처리 중입니다. 중복 입력은 실행하지 않았습니다.'
            : '입력 대기 중인 실행안을 찾지 못해 아무 작업도 실행하지 않았습니다. 앱을 다시 켰거나 입력이 오래된 경우 처음 요청부터 다시 진행해 주세요.';
          return {
            role: 'assistant' as const,
            content,
            requestId: chatRequestId,
            changedWorkflowIds: [],
            removedWorkflowIds: [],
            inputRequests,
            presentations,
          };
        }
        pendingCommandClaim = { token: claim.token, command: claim.command, inputValues: claim.inputValues };
      } else {
        clearPendingCommand(safeWorkspaceSessionId);
      }
      if (!pendingCommandClaim && !app.isPackaged && process.env.AX_E2E === '1' && process.env.AX_E2E_FAKE_AGENT === '1') {
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
      // Keep the revision paired with this synchronous connection snapshot.
      const connectionRevision = typeof core.store.getConnectionRevision === 'function'
        ? core.store.getConnectionRevision()
        : undefined;
      const connectedConnectors = connectedConnectorIds(connections);
      const httpEndpoints = httpEndpointsFromConnections(connections).map((endpoint) => ({
        id: endpoint.id,
        ...(endpoint.label ? { label: endpoint.label } : {}),
        usable: endpoint.auth?.type === undefined || endpoint.auth.type === 'none' || endpoint.authStored === true,
      }));
      const reply = await runAxCommandChat({
        requestId: chatRequestId,
        harness: core.agentHarness,
        commandService: core.commandService,
        decisionEngine: core.decisionEngine,
        connectedConnectors,
        httpEndpoints,
        resolveReadOperationSelection: () => selectJevReadOperations(
          core.store,
          connectionRevision,
          connections,
          userMessage,
        ),
        messages: history,
        userMessage,
        ...(previousReadResult ? { previousReadResult } : {}),
        ...(pendingInput && pendingCommandClaim ? {
          decisionMessage: pendingInput.request,
          commandInputValues: pendingCommandClaim.inputValues,
        } : {}),
        ...(pendingCommandClaim ? { pendingCommand: pendingCommandClaim.command } : {}),
        currentWorkflowId: effectiveWorkflowId,
        currentWorkflowVersion,
        currentWorkflowSteps,
        currentWorkflowOutputs,
        sessionMemo: safeWorkspaceSessionId
          ? core.store.getWorkspaceChatMemo(safeWorkspaceSessionId)
          : {},
        workflowPolicy: effectiveWorkflowId
          ? core.store.getWorkflowPolicy(effectiveWorkflowId)
          : {},
        contextUpdateConfirmation: confirmedContextUpdate,
        allowJobCommit: jobCommitConfirmed,
        jobCommitConfirmationToken,
        workspaceSessionId: safeWorkspaceSessionId,
        resolveWorkspaceSources: () => safeWorkspaceSessionId
          ? core.workspaceSources.list(safeWorkspaceSessionId)
          : [],
        designToolContextFactory: () => buildDesktopDesignToolContext(core, connections, connectedConnectors),
        abortSignal: controller.signal,
        timeoutMs: AX_COMMAND_CHAT_TIMEOUT_MS,
        onCommandResult: (result, command) => {
          const ids = workflowIdsChanged(result);
          if (ids.changed) changedWorkflowIds.add(ids.changed);
          if (ids.removed) removedWorkflowIds.add(ids.removed);
          if (!command || !['execution.enqueue_once', 'workflow.create', 'workflow.update', 'job.propose'].includes(command.name)
            || !result.inputRequests?.length) {
            if (pendingCommandClaim) finishClaimedPendingCommand(safeWorkspaceSessionId, pendingCommandClaim.token);
            return;
          }
          if (pendingCommandClaim) {
            pendingInputRequestToken = replaceClaimedPendingCommand(
              safeWorkspaceSessionId,
              pendingCommandClaim.token,
              command,
              Date.now(),
              pendingInput?.request ?? userMessage,
            );
          } else {
            pendingInputRequestToken = rememberPendingCommand(
              safeWorkspaceSessionId,
              command,
              Date.now(),
              pendingInput?.request ?? userMessage,
            );
          }
        },
        onInputRequests: (requests) => {
          inputRequests = pendingInputRequestToken
            ? requests.map((request) => ({ ...request, id: `${request.id}-${pendingInputRequestToken}` }))
            : requests;
          if (pendingInputRequestToken) {
            bindPendingCommandInputRequests(
              safeWorkspaceSessionId,
              pendingInputRequestToken,
              inputRequests,
            );
          }
        },
        onPresentation: (presentation) => {
          const scopedPresentation = pendingInputRequestToken
            ? {
                ...presentation,
                inputs: presentation.inputs.map((request) => ({
                  ...request,
                  id: `${request.id}-${pendingInputRequestToken}`,
                })),
              }
            : presentation;
          presentations.push(scopedPresentation);
          if (pendingInputRequestToken) {
            bindPendingCommandInputRequests(
              safeWorkspaceSessionId,
              pendingInputRequestToken,
              scopedPresentation.inputs,
            );
          }
        },
        onReadResult: (table) => {
          if (!table) {
            readResult = undefined;
            return;
          }
          const parsed = WorkspaceChatReadResultSchema.safeParse(table);
          readResult = parsed.success ? parsed.data : undefined;
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
        ...(pendingInputRequestToken ? { inputContinuation: 'command' as const } : {}),
        ...(readResult ? { readResult } : {}),
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
      if (pendingCommandClaim) {
        finishClaimedPendingCommand(safeWorkspaceSessionId, pendingCommandClaim.token);
      }
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

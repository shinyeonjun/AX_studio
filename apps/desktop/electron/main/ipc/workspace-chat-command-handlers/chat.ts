import {
  aiProviderErrorMessage,
  appendAppLog,
  AX_COMMAND_CHAT_TIMEOUT_MS,
  connectedConnectorIds,
  httpEndpointsFromConnections,
  runAxCommandChat,
  sourceChoiceFromReply,
} from '@ax-studio/core';
import { app } from 'electron';
import { performance } from 'node:perf_hooks';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import {
  boundedText,
  commandInputContinuation,
  selectChatContext,
  selectMessagesThroughUserMessage,
  selectMessagesThroughUserTurn,
} from '../chat-boundary.js';
import { buildDesktopDesignToolContext } from '../design-tool-context.js';
import {
  registerWorkspaceChat,
  releaseWorkspaceChat,
} from '../../workspace-chat-registry.js';
import { shouldUseE2EFakeAgent } from '../../e2e-test-seam/gates.js';
import {
  claimPendingCommand,
  clearPendingCommand,
  finishClaimedPendingCommand,
} from './pending-command.js';
import {
  contextUpdateConfirmation as findContextUpdateConfirmation,
  hasContextConfirmation,
  isJobConfirmation,
  mutationConfirmationToken as findMutationConfirmationToken,
} from './helpers.js';
import { bindContextConfirmations, clearHostChatSession, hostReadRecipeFor, hostReadResultFor, rememberHostReadResult } from './host-state.js';
import { metadataTerminalReply, registeredHttpMetadataAvailable, runRegisteredHttpMetadataTurn } from './metadata-turns.js';
import { readableConnections, selectJevReadOperations } from './read-operation-index.js';
import { runE2EChatTurn } from './e2e-turn.js';
import {
  currentWorkflowOutputs,
  currentWorkflowSteps,
  requestsMetadataLane,
  validatedWorkspaceSessionId,
} from './turn-context.js';
import { chatTurnCallbacks, emptyChatTurnState, type PendingCommandClaim } from './turn-state.js';

export function registerWorkspaceChatMessageHandler() {
  ipcHandle('ax:sendCommandChat', async (
    event,
    userMessageInput: unknown,
    requestId?: unknown,
    workflowId?: unknown,
    workspaceSessionId?: unknown,
    chatOptions?: unknown,
  ) => {
    const core = getCore();
    const startedAt = performance.now();
    const safeWorkspaceSessionId = validatedWorkspaceSessionId(workflowId, workspaceSessionId);
    const storedChat = core.store.getWorkspaceChat(safeWorkspaceSessionId);
    if (!storedChat) throw new Error('대화를 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
    const userMessage = boundedText(userMessageInput, '사용자 메시지').trim();
    const metadataLane = requestsMetadataLane(chatOptions);
    if (metadataLane && !registeredHttpMetadataAvailable()) {
      return metadataTerminalReply(typeof requestId === 'string' ? requestId : 'metadata-unavailable',
        'gate_unavailable', '등록된 HTTP 메타데이터 경로를 현재 사용할 수 없습니다.');
    }
    const exactTurn = typeof requestId === 'string' && storedChat.messages.some(message => message.role === 'user' && message.turnId === requestId);
    const requestMessages = metadataLane || exactTurn
      ? selectMessagesThroughUserTurn(storedChat.messages, userMessage, requestId)
      : selectMessagesThroughUserMessage(storedChat.messages, userMessage);
    const pendingInput = commandInputContinuation(requestMessages);
    if (metadataLane) {
      const metadataRequestId = requestId as string;
      if (pendingInput || requestMessages.at(-2)?.inputContinuation === 'command'
        || hasContextConfirmation(requestMessages, userMessage) || isJobConfirmation(requestMessages, userMessage)
        || findMutationConfirmationToken(requestMessages, userMessage)) {
        return metadataTerminalReply(metadataRequestId, 'continuation_not_supported', '입력 또는 명령 확인 이어가기는 이 메타데이터 경로에서 지원하지 않습니다. 새 요청을 저장해 주세요.');
      }
      return runRegisteredHttpMetadataTurn({ store: core.store, commandService: core.commandService, harness: core.agentHarness,
        sessionId: safeWorkspaceSessionId, requestId: metadataRequestId, userText: userMessage,
        onProgress: message => event.sender.send('ax:chat-progress', { message, requestId: metadataRequestId }),
      });
    }
    const requestedWorkflowId = typeof workflowId === 'string' ? workflowId.trim() : undefined;
    const mappedWorkflowId = storedChat.workflowId;
    const effectiveWorkflowId = requestedWorkflowId || mappedWorkflowId;
    const currentWorkflow = effectiveWorkflowId ? core.store.getWorkflow(effectiveWorkflowId) : undefined;
    const workflowSteps = currentWorkflowSteps(currentWorkflow);
    const workflowOutputs = currentWorkflowOutputs(currentWorkflow);
    // Confirmation payloads and tokens are verified host-side; the transcript only names them.
    const confirmedContextUpdate = findContextUpdateConfirmation(requestMessages, userMessage, safeWorkspaceSessionId);
    const jobCommitConfirmationToken = isJobConfirmation(requestMessages, userMessage);
    const jobCommitConfirmed = Boolean(jobCommitConfirmationToken);
    const mutationConfirmationToken = jobCommitConfirmed
      ? undefined
      : findMutationConfirmationToken(requestMessages, userMessage);
    // A pick in the "어디에서 찾을까요?" card is remembered: the same kind of request goes there next time.
    const pickedSource = sourceChoiceFromReply(requestMessages, userMessage);
    if (pickedSource) core.store.rememberSourceChoice(pickedSource);
    // Rendering metadata belongs to the host transcript, not the provider prompt.
    const history = selectChatContext(requestMessages).slice(0, -1).map(({ role, content }) => ({ role, content }));
    // Rows come from the host cache of what it displayed, never from the renderer-saved transcript.
    const previousReadResult = hostReadResultFor(safeWorkspaceSessionId, requestMessages);
    const previousReadRecipe = hostReadRecipeFor(safeWorkspaceSessionId, requestMessages);
    const chatRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : `command-chat-${Date.now()}`;
    const historyChars = history.reduce((total, message) => total + message.content.length, 0);
    const controller = registerWorkspaceChat(chatRequestId, safeWorkspaceSessionId);
    const turn = emptyChatTurnState();
    let pendingCommandClaim: PendingCommandClaim | undefined;
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
            inputRequests: turn.inputRequests,
            presentations: turn.presentations,
          };
        }
        pendingCommandClaim = { ...claim };
      } else {
        clearPendingCommand(safeWorkspaceSessionId);
      }
      if (!pendingCommandClaim && shouldUseE2EFakeAgent(app.isPackaged, process.env)) {
        const reply = await runE2EChatTurn(core, userMessage, safeWorkspaceSessionId, chatRequestId);
        outcome = 'success';
        return reply;
      }
      const connections = readableConnections(core.store.getConnections(), core.runtime?.connectors.rdb);
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
        connectionRevision,
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
        ...(previousReadRecipe ? { previousReadRecipe } : {}),
        ...(pendingInput && pendingCommandClaim ? {
          decisionMessage: pendingCommandClaim.request,
          requestAnchor: pendingCommandClaim.requestAnchor,
          commandInputValues: pendingCommandClaim.inputValues,
        } : {}),
        ...(pendingCommandClaim ? { pendingCommand: pendingCommandClaim.command } : {}),
        currentWorkflowId: effectiveWorkflowId,
        currentWorkflowVersion: currentWorkflow?.version,
        currentWorkflowSteps: workflowSteps,
        currentWorkflowOutputs: workflowOutputs,
        sessionMemo: safeWorkspaceSessionId
          ? core.store.getWorkspaceChatMemo(safeWorkspaceSessionId)
          : {},
        workflowPolicy: effectiveWorkflowId
          ? core.store.getWorkflowPolicy(effectiveWorkflowId)
          : {},
        contextUpdateConfirmation: confirmedContextUpdate,
        allowJobCommit: jobCommitConfirmed,
        jobCommitConfirmationToken,
        ...(mutationConfirmationToken ? { mutationConfirmationToken } : {}),
        workspaceSessionId: safeWorkspaceSessionId,
        resolveWorkspaceSources: () => safeWorkspaceSessionId
          ? core.workspaceSources.list(safeWorkspaceSessionId)
          : [],
        designToolContextFactory: () => buildDesktopDesignToolContext(core, connections, connectedConnectors),
        pastSourceChoices: core.store.getSourceChoices(),
        columnLabels: {
          known: () => core.store.getColumnLabels(),
          remember: (labels) => core.store.rememberColumnLabels(labels),
        },
        abortSignal: controller.signal,
        timeoutMs: AX_COMMAND_CHAT_TIMEOUT_MS,
        ...chatTurnCallbacks(turn, {
          sessionId: safeWorkspaceSessionId,
          userMessage,
          claim: pendingCommandClaim,
        }),
        onProgress: ({ message }) => {
          event.sender.send('ax:chat-progress', { message, requestId: chatRequestId });
        },
      });
      outcome = 'success';
      if (turn.readResultReported) rememberHostReadResult(safeWorkspaceSessionId, turn.readResult, turn.readRecipe);
      return {
        role: 'assistant' as const,
        content: reply,
        requestId: chatRequestId,
        changedWorkflowIds: [...turn.changedWorkflowIds],
        removedWorkflowIds: [...turn.removedWorkflowIds],
        ...(turn.pendingInputRequestToken ? { inputContinuation: 'command' as const } : {}),
        // Offer "반복 업무로" only where the read can actually be repeated.
        ...(turn.readResult ? { readResult: turn.readResult, ...(turn.readRecipe ? { readRepeatable: true } : {}) } : {}),
        inputRequests: turn.inputRequests,
        presentations: bindContextConfirmations(safeWorkspaceSessionId, turn.presentations),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : String(error);
      appendAppLog('error', message && message !== '{' ? message : 'command chat failed', {
        event: 'desktop_command_chat',
        requestId: chatRequestId,
      });
      // Common provider failures (timeout, bad key, busy, CLI missing) say what to do; other
      // messages keep passing through for the renderer to word or show.
      throw new Error(aiProviderErrorMessage(error)
        ?? (message && message !== '{' ? message : 'AI가 답하지 못했어요. 설정에서 AI 연결을 확인해 주세요.'));
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
      // A turn that finished after its chat was deleted must not leave state behind for it.
      if (!core.store.getWorkspaceChat(safeWorkspaceSessionId)) {
        clearPendingCommand(safeWorkspaceSessionId, true);
        clearHostChatSession(safeWorkspaceSessionId);
      }
    }
  });
}

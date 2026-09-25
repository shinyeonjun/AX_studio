import type { ChatMessage } from '../../model/chat.js';
import { isRecoverableConnectorFailure } from '../../../../connectors/failure-kind.js';
import type { AxCommandChatOptions } from './contracts.js';
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import {
  AxCapabilityInvokeArgsSchema,
  AxContextUpdateConfirmationSchema,
  type AxCommand,
  type AxCommandResult,
} from '../schema.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import {
  CurrentUserRequestTooLargeError,
  compactModelMessages,
  chatReplyPrompt,
  jevUnavailableChatReplyPrompt,
  jevUnsupportedChatReplyPrompt,
  resultMessage,
} from './protocol.js';
import {
  deterministicHttpChatReply,
  deterministicHttpConnectionListChatReply,
  deterministicCapabilityReadChatReply,
  deterministicMetadataChatReply,
  deterministicWorkflowListChatReply,
  boundedChatReadResult,
  formatTableArtifact,
  hostFacingMessage,
  selectedColumnsFromHttpPath,
  tableForJevTransform,
  type CommandChatSessionState,
} from './result.js';
import {
  applyJevTableTransform,
  type JevTableTransformRequest,
} from './jev-table-transform.js';
import {
  httpEndpointSelectionMessage,
  httpEndpointSelectionPresentation,
  httpReadPathRequiredMessage,
  needsExplicitHttpEndpointSelection,
  selectedHttpReadCommand,
} from './connection-selection/http-endpoint-selection.js';
import { routeChatWithJev } from './jev-router.js';
import { applyJevCommandInputValuesToCommand } from './jev-action-catalog.js';
import { appendAppLog } from '../../../../persistence/paths/app-log.js';

function readAuthorizationFor(command: AxCommand): {
  capabilityId: string;
  params: Record<string, unknown>;
} | undefined {
  if (command.name !== 'capability.invoke') return undefined;
  const parsed = AxCapabilityInvokeArgsSchema.safeParse(command.args);
  if (!parsed.success) return undefined;
  return { capabilityId: parsed.data.id, params: parsed.data.params };
}

function readOperationIdentity(capabilityId: string, params: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(params);
    return serialized === undefined ? undefined : `${capabilityId}\0${serialized}`;
  } catch {
    return undefined;
  }
}

function workflowUpdateSuccessMessage(result: AxCommandResult): string {
  const data = result.data;
  const reauthorizationRequired = data && typeof data === 'object'
    && (data as Record<string, unknown>).reauthorizationRequired === true;
  return reauthorizationRequired
    ? 'workflow를 수정했습니다. 실행 가능한 내용이 바뀌어 자동 실행을 중지했으니 다시 활성화하기 전에 검토해 주세요.'
    : 'workflow를 수정했습니다.';
}

function isRecoverableReadFailure(
  result: AxCommandResult,
): result is AxCommandResult & { status: 'error' | 'not_found' } {
  if (result.status !== 'error' && result.status !== 'not_found') return false;
  if (result.issues.length === 0) return result.status === 'not_found';
  return result.issues.every((item) => item.failureKind !== undefined
    && isRecoverableConnectorFailure(item.failureKind));
}

function shouldUseJevRoute(options: AxCommandChatOptions): boolean {
  return Boolean(options.decisionEngine) && !options.allowJobCommit;
}

type ChatCommandExecutionOptions = NonNullable<Parameters<AxCommandChatOptions['commandService']['execute']>[1]>;

async function executeChatCommand(
  options: AxCommandChatOptions,
  command: AxCommand,
  executionOptions: ChatCommandExecutionOptions,
): Promise<AxCommandResult> {
  const startedAt = performance.now();
  let outcome: string = 'threw';
  try {
    const result = await options.commandService.execute(command, executionOptions);
    outcome = result.status;
    return result;
  } finally {
    appendAppLog('info', 'Chat command execution timing recorded.', {
      ...(options.requestId ? { requestId: options.requestId } : {}),
      event: 'chat_command_execution_timing',
      command: command.name,
      outcome,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

type JevFallbackReason = Extract<Awaited<ReturnType<typeof routeChatWithJev>>, { kind: 'fallback' }>['reason'];

function jevFallbackMessage(reason: JevFallbackReason): string {
  switch (reason) {
    case 'service_error':
      return '의미 판단 서비스를 확인할 수 없어 작업을 실행하지 않았습니다. 연결을 확인하고 다시 시도해 주세요.';
    case 'missing_context':
      return '요청을 처리할 연결·자료·대상이 부족합니다. 사용할 연결이나 대상을 지정해 주세요.';
    case 'http_endpoint_required':
      return '조회할 HTTP 연결을 하나 선택해 주세요.';
    case 'http_path_required':
      return httpReadPathRequiredMessage();
    case 'uncertain':
      return '요청을 확실히 판단하지 못해 작업을 실행하지 않았습니다. 원하는 결과와 대상을 조금 더 구체적으로 알려 주세요.';
    case 'unsupported':
      return '현재 연결된 기능 중 요청에 맞는 작업을 찾지 못했습니다. 연결된 도구나 요청 내용을 확인해 주세요.';
  }
}

function missingReadValuesMessage(paths: readonly string[]): string {
  const names = [...new Set(paths.map((path) => path.slice(path.lastIndexOf('.') + 1)))];
  return `조회에 필요한 값(${names.join(', ')})을 요청에서 확인하지 못했습니다. 값을 알려 주세요.`;
}

export interface CommandChatLoopContext {
  readonly options: AxCommandChatOptions;
  readonly messages: ChatMessage[];
  readonly session: CommandChatSessionState;
  readonly signal: AbortSignal;
  readonly publishResult: (commandName: string, result: AxCommandResult, command?: AxCommand) => AxCommandResult;
}

async function presentHttpEndpointSelection({ options, signal, publishResult }: CommandChatLoopContext): Promise<string> {
  const endpoints = options.httpEndpoints ?? [];
  const command: AxCommand = {
    name: 'ui.present',
    args: httpEndpointSelectionPresentation(endpoints),
  };
  const result = await executeChatCommand(options, command, {
    executionContext: AGENT_COMMAND_CONTEXT,
    userMessage: options.userMessage,
    workspaceSessionId: options.workspaceSessionId,
    abortSignal: signal,
  });
  signal.throwIfAborted();
  return hostFacingMessage(
    publishResult('ui.present', result),
    httpEndpointSelectionMessage(endpoints),
  );
}

export async function runCommandChatLoop({
  options,
  messages,
  session,
  signal,
  publishResult,
}: CommandChatLoopContext): Promise<string | undefined> {
  const requestContext = options.requestId ? { requestId: options.requestId } : {};
  signal.throwIfAborted();
  if (options.allowJobCommit) {
    const result = await executeChatCommand(options, { name: 'job.commit', args: {} }, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: options.workspaceSessionId,
      allowJobCommit: true,
      jobCommitConfirmationToken: options.jobCommitConfirmationToken,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    return hostFacingMessage(publishResult('job.commit', result), '업무를 저장하지 못했습니다.');
  }

  if (options.contextUpdateConfirmation) {
    const parsed = AxContextUpdateConfirmationSchema.safeParse(options.contextUpdateConfirmation);
    if (!parsed.success) return '저장 확인 데이터가 올바르지 않아 아무 내용도 저장하지 않았습니다.';
    const confirmation = parsed.data;
    if (confirmation.scope === 'workflow'
      && confirmation.workflowId !== options.currentWorkflowId?.trim()) {
      return '확인한 workflow가 현재 선택된 workflow와 달라 저장하지 않았습니다. 해당 workflow에서 다시 확인해 주세요.';
    }
    const command: AxCommand = {
      name: 'context.update',
      args: {
        scope: confirmation.scope,
        set: { [confirmation.key]: confirmation.value },
        confirmed: true,
      },
    };
    const result = await executeChatCommand(options, command, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: options.workspaceSessionId,
      currentWorkflowId: confirmation.workflowId ?? options.currentWorkflowId,
      allowContextUpdate: true,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    return hostFacingMessage(publishResult('context.update', result), '기억을 저장하지 못했습니다.');
  }

  if (options.pendingCommand) {
    const command = applyJevCommandInputValuesToCommand(
      options.pendingCommand,
      options.commandInputValues ?? [],
    );
    if (!command) return '입력 대기 중인 실행안을 확인하지 못해 아무 작업도 실행하지 않았습니다. 처음 요청부터 다시 진행해 주세요.';
    const result = await executeChatCommand(options, command, {
      executionContext: AGENT_COMMAND_CONTEXT,
      userMessage: options.decisionMessage ?? options.userMessage,
      workspaceSessionId: options.workspaceSessionId,
      currentWorkflowId: session.workflowId,
      abortSignal: signal,
      designToolContext: options.designToolContext,
      designToolContextFactory: options.designToolContextFactory,
    });
    signal.throwIfAborted();
    const resultForLoop = publishResult(command.name, result, command);
    const fallback = command.name === 'workflow.create'
      ? resultForLoop.status === 'ok'
        ? '수동 workflow를 저장했습니다. 자동 실행은 활성화되지 않았습니다.'
        : 'workflow를 저장하지 못했습니다.'
      : command.name === 'job.propose'
        ? resultForLoop.status === 'ok'
          ? '업무 초안을 준비했습니다. 검토 후 확인해 주세요.'
          : '업무 초안을 처리하지 못했습니다.'
        : command.name === 'workflow.update'
          ? resultForLoop.status === 'ok'
            ? workflowUpdateSuccessMessage(resultForLoop)
            : 'workflow를 수정하지 못했습니다.'
          : resultForLoop.status === 'queued' || resultForLoop.status === 'ok'
            ? '일회 실행을 큐에 등록했습니다. 실행 상태에서 진행 상황을 확인해 주세요.'
            : '일회 실행을 처리하지 못했습니다.';
    return hostFacingMessage(
      resultForLoop,
      fallback,
    );
  }

  // With no Jev engine, an explicit GET/HEAD path can still safely ask the
  // user to choose among endpoints; natural-language routing stays fail-closed.
  if (!options.decisionEngine && needsExplicitHttpEndpointSelection(options.userMessage, options.httpEndpoints ?? [])) {
    return presentHttpEndpointSelection({ options, messages, session, signal, publishResult });
  }

  const textReplyFromModel = async (
    phase: string,
    systemPrompt?: string,
    replyMessages: ChatMessage[] = messages,
    requiredUserMessage = options.userMessage,
  ): Promise<string | undefined> => {
    try {
      const reply = await options.harness.runText({
        requestId: options.requestId,
        role: 'command',
        systemPrompt: systemPrompt ?? chatReplyPrompt(options),
        messages: compactModelMessages(replyMessages, requiredUserMessage),
        sessionId: options.providerSessionId,
        onProgress: options.onProgress,
        logContext: phase,
        abortSignal: signal,
      });
      const output = reply.output.trim();
      if (!output) return undefined;
      appendAppLog('info', 'Chat received a text-only reply.', {
        ...requestContext,
        event: 'chat_reply_generated',
        phase,
        provider: reply.provider,
        durationMs: reply.durationMs,
        promptChars: reply.promptChars,
        providerUsageAvailable: Boolean(reply.usage),
        ...(reply.usage ? { usage: reply.usage } : {}),
      });
      return output;
    } catch (error) {
      signal.throwIfAborted();
      appendAppLog('warn', 'Chat text reply could not be generated; no command-model fallback will run.', {
        ...requestContext,
        event: 'chat_text_reply_failed',
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof CurrentUserRequestTooLargeError) {
        return '현재 요청이 너무 길어 내용을 온전히 답변에 반영할 수 없습니다. 요청을 나눠 보내거나 긴 자료를 파일로 첨부해 주세요.';
      }
      return undefined;
    }
  };

  const jevTransformReply = async (
    command: AxCommand,
    result: AxCommandResult,
    userMessage: string,
    request?: JevTableTransformRequest,
    projection?: 'requested_columns',
  ): Promise<{ reply: string } | { table: TableArtifact } | { confirmedNoTransform: true } | undefined> => {
    if (request === 'none' && !projection) return { confirmedNoTransform: true };
    if (!options.decisionEngine) return undefined;
    if (request === 'uncertain') {
      return { reply: '필터·정렬 요청을 하나의 안전한 표 변환으로 판단하지 못했습니다. 기준과 순서를 조금 더 구체적으로 알려 주세요.' };
    }
    const table = tableForJevTransform(command, result);
    if (!table) {
      const tableActions = [
        ...(projection ? ['요청한 열 선택'] : []),
        ...(request && request !== 'none' && request !== 'auto' ? ['필터·정렬'] : []),
      ];
      return tableActions.length > 0
        ? { reply: `조회 결과가 표 형태가 아니어서 ${tableActions.join(' 및 ')}을 적용할 수 없습니다. 결과 형식이나 요청을 확인해 주세요.` }
        : undefined;
    }

    const startedAt = Date.now();
    const plan = await applyJevTableTransform({
      decisionEngine: options.decisionEngine,
      table,
      userMessage,
      mode: request ?? 'auto',
      selectRequestedColumns: projection === 'requested_columns',
      httpSelectedColumns: command.name === 'capability.invoke' && command.args.id === 'http.request'
        ? selectedColumnsFromHttpPath(command.args.params)
        : undefined,
      abortSignal: signal,
    });
    if (plan.status === 'not_applicable') return { confirmedNoTransform: true };
    appendAppLog('info', 'Jev table transform decision recorded.', {
      ...requestContext,
      event: 'jev_chat_table_transform',
      durationMs: Date.now() - startedAt,
      status: plan.status,
      ...('providerRequestCount' in plan && plan.providerRequestCount !== undefined
        ? { providerRequestCount: plan.providerRequestCount } : {}),
      ...('model' in plan && plan.model ? { model: plan.model } : {}),
      ...(!('usage' in plan) || plan.usage?.inputTokens === undefined ? {} : { inputTokens: plan.usage.inputTokens }),
      ...(!('usage' in plan) || plan.usage?.outputTokens === undefined ? {} : { outputTokens: plan.usage.outputTokens }),
      ...(plan.status === 'transformed' ? { rowCount: plan.table.rows.length } : {}),
    });
    if (plan.status === 'transformed') return { table: plan.table };
    if (plan.status === 'clarify') return { reply: plan.message };
    const unavailableWork = [
      ...(request && request !== 'none' && request !== 'auto' ? ['필터·정렬'] : []),
      ...(projection ? ['요청한 열 선택'] : []),
    ].join(' 및 ') || '요청한 결과 변환';
    return { reply: `조회는 완료했지만 Jev 판단을 확인할 수 없어 ${unavailableWork}을 적용하지 않았습니다. 잠시 후 다시 시도해 주세요.` };
  };

  const successfulCommandReply = async (
    command: AxCommand,
    result: AxCommandResult,
    userIntent: string,
    phase: string,
    fallback: string,
    route?: string,
    tableTransform?: JevTableTransformRequest,
    tableProjection?: 'requested_columns',
    readResultStyle?: 'summary',
  ): Promise<string> => {
    const transformOutcome = await jevTransformReply(command, result, userIntent, tableTransform, tableProjection);
    const invokeArgs = command.name === 'capability.invoke'
      ? AxCapabilityInvokeArgsSchema.safeParse(command.args)
      : undefined;
    const explicitHttpRead = invokeArgs?.success === true && invokeArgs.data.id === 'http.request'
      && ['GET', 'HEAD'].includes(String(invokeArgs.data.params.method ?? 'GET').toUpperCase());
    if (route === 'capability_read' || route === 'http_read' || explicitHttpRead) {
      const table = transformOutcome && 'table' in transformOutcome
        ? transformOutcome.table
        : tableForJevTransform(command, result);
      options.onReadResult?.(table ? boundedChatReadResult(table) : undefined);
    }
    if (readResultStyle === 'summary') {
      if (transformOutcome && 'reply' in transformOutcome) return transformOutcome.reply;
      const summaryResult = transformOutcome && 'table' in transformOutcome
        && result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? { ...result, data: { ...result.data, data: transformOutcome.table } }
        : result;
      const evidence = resultMessage(summaryResult);
      const commandMessage: ChatMessage = {
        role: 'assistant', content: JSON.stringify({ kind: 'command', command }),
      };
      const evidenceMessage: ChatMessage = { role: 'user', content: evidence };
      const summaryMessages: ChatMessage[] = [
        { role: 'user', content: userIntent },
        commandMessage,
        evidenceMessage,
      ];
      messages.push(commandMessage, evidenceMessage);
      const reply = await textReplyFromModel(
        'ax_command_chat_jev_summary',
        undefined,
        summaryMessages,
        userIntent,
      );
      return reply ?? hostFacingMessage(result, '조회는 완료했지만 요약을 생성하지 못했습니다.');
    }
    if (transformOutcome && 'reply' in transformOutcome) return transformOutcome.reply;
    if (transformOutcome && 'table' in transformOutcome) return formatTableArtifact(transformOutcome.table);

    const jevConfirmedNoTransform = tableTransform === 'none' || transformOutcome?.confirmedNoTransform === true;
    const deterministicReply = deterministicHttpChatReply(command, result, userIntent, jevConfirmedNoTransform)
      ?? deterministicHttpConnectionListChatReply(command, result, userIntent)
      ?? deterministicCapabilityReadChatReply(command, result, userIntent, jevConfirmedNoTransform)
      ?? deterministicMetadataChatReply(command, result, userIntent)
      ?? deterministicWorkflowListChatReply(command, result, userIntent);
    if (deterministicReply) {
      if (route) {
        appendAppLog('info', 'Jev-selected read used a deterministic chat renderer.', {
          ...requestContext,
          event: 'jev_chat_deterministic_reply',
          route,
          command: command.name,
        });
      }
      return deterministicReply;
    }

    messages.push(
      { role: 'assistant', content: JSON.stringify({ kind: 'command', command }) },
      { role: 'user', content: resultMessage(result) },
    );
    const reply = await textReplyFromModel(phase);
    return reply ?? hostFacingMessage(result, fallback);
  };

  const selectedHttpRead = selectedHttpReadCommand(options.userMessage, messages, options.httpEndpoints ?? []);
  if (selectedHttpRead) {
    const { command, userIntent } = selectedHttpRead;
    const readAuthorization = readAuthorizationFor(command);
    const result = await executeChatCommand(options, command, {
      executionContext: AGENT_COMMAND_CONTEXT,
      userMessage: options.userMessage,
      workspaceSessionId: options.workspaceSessionId,
      currentWorkflowId: session.workflowId,
      abortSignal: signal,
      designToolContext: options.designToolContext,
      designToolContextFactory: options.designToolContextFactory,
      ...(readAuthorization ? { readAuthorization } : {}),
    });
    signal.throwIfAborted();
    const resultForLoop = publishResult(command.name, result);
    if (resultForLoop.status !== 'ok') {
      return hostFacingMessage(resultForLoop, 'HTTP 조회를 처리하지 못했습니다.');
    }
    return successfulCommandReply(
      command,
      resultForLoop,
      userIntent,
      'ax_command_chat_selected_http_result',
      'HTTP 조회는 처리했지만 결과 설명을 생성하지 못했습니다.',
    );
  }

  const useJevRoute = shouldUseJevRoute(options);
  if (!useJevRoute) {
    const jevUnavailable = !options.decisionEngine;
    const reply = await textReplyFromModel(
      jevUnavailable ? 'ax_command_chat_no_jev' : 'ax_command_chat_text',
      jevUnavailable ? jevUnavailableChatReplyPrompt(options) : chatReplyPrompt(options),
    );
    if (reply) return reply;
    if (jevUnavailable) {
      return 'Jev 판단 서비스가 연결되지 않아 자료 조회나 외부 작업을 수행하지 않았습니다. Jev를 연결한 뒤 다시 요청해 주세요.';
    }
  }

  if (options.decisionEngine && useJevRoute) {
    const readOperationCatalogPreparationStartedAt = Date.now();
    const readOperationSelection = options.resolveReadOperationSelection?.();
    const readOperationCatalogPreparationMs = Date.now() - readOperationCatalogPreparationStartedAt;
    const readOperationHints = readOperationSelection?.hints ?? options.readOperationHints;
    const readOperationCatalogSize = readOperationSelection?.totalCount ?? options.readOperationCatalogSize;
    const readOperationCatalogMayBeBounded = readOperationSelection?.catalogMayBeBounded
      ?? options.readOperationCatalogMayBeBounded;
    const readOperationSelectionMode = readOperationSelection?.mode ?? options.readOperationSelectionMode;
    const readOperationLexicalMatchedOperationCount = readOperationSelection?.lexicalMatchedOperationCount
      ?? options.readOperationLexicalMatchedOperationCount;
    const readOperationLexicalTopScore = readOperationSelection?.lexicalTopScore
      ?? options.readOperationLexicalTopScore;
    const jevStartedAt = Date.now();
    let jevRoute: Awaited<ReturnType<typeof routeChatWithJev>> = { kind: 'fallback', reason: 'service_error' };
    let jevTelemetry: Awaited<ReturnType<typeof routeChatWithJev>>['telemetry'];
    let jevRouteOutcome = 'error';
    try {
      jevRoute = await routeChatWithJev({
        decisionEngine: options.decisionEngine,
        userMessage: options.decisionMessage ?? options.userMessage,
        currentWorkflowId: session.workflowId,
        currentWorkflowVersion: options.currentWorkflowVersion,
        currentWorkflowSteps: options.currentWorkflowSteps,
        currentWorkflowOutputs: options.currentWorkflowOutputs,
        sessionMemo: options.sessionMemo,
        workflowPolicy: session.workflowPolicy,
        hasWorkspaceSession: Boolean(options.workspaceSessionId),
        connectedConnectors: options.connectedConnectors,
        actionInputValues: options.commandInputValues,
        httpEndpoints: options.httpEndpoints,
        readOperationHints,
        readOperationCatalogSize,
        readOperationCatalogMayBeBounded,
        readOperationSelectionMode,
        readOperationLexicalMatchedOperationCount,
        readOperationLexicalTopScore,
        previousReadResult: options.previousReadResult,
        workspaceSources: options.workspaceSources,
        resolveWorkspaceSources: options.resolveWorkspaceSources,
        abortSignal: signal,
      });
      jevTelemetry = jevRoute.telemetry;
      jevRouteOutcome = jevRoute.kind === 'fallback'
        ? `fallback:${jevRoute.reason}`
        : `${jevRoute.kind}:${jevRoute.route}`;
    } finally {
      appendAppLog('info', 'Jev chat route timing recorded.', {
        ...requestContext,
        event: 'jev_chat_route_timing',
        durationMs: Date.now() - jevStartedAt,
        readOperationCatalogPreparationMs,
        outcome: jevRouteOutcome,
        readOperationHintCount: readOperationHints?.length ?? 0,
        readOperationCatalogSize,
        readOperationCatalogMayBeBounded,
        readOperationSelectionMode,
        readOperationLexicalMatchedOperationCount,
        readOperationLexicalTopScore,
        ...(jevTelemetry ? {
          jevModel: jevTelemetry.model,
          jevInputTokens: jevTelemetry.inputTokens,
          jevOutputTokens: jevTelemetry.outputTokens,
          jevSelectedRoute: jevTelemetry.selectedRoute,
          jevRouteConfidence: jevTelemetry.routeConfidence,
          jevActionScopeChoice: jevTelemetry.actionScopeChoice,
          jevActionScopeConfidence: jevTelemetry.actionScopeConfidence,
          jevActionCandidateSelected: jevTelemetry.actionCandidateSelected,
          jevActionCandidateConfidence: jevTelemetry.actionCandidateConfidence,
          jevQuestionIds: jevTelemetry.questionIds,
          jevRouteCandidateCount: jevTelemetry.routeCandidateCount,
          jevOperationCandidateCount: jevTelemetry.operationCandidateCount,
          jevOperationCatalogSize: jevTelemetry.operationCatalogSize,
          jevOperationCatalogMayBeBounded: jevTelemetry.operationCatalogMayBeBounded,
          jevOperationSelectionMode: jevTelemetry.operationSelectionMode,
          jevOperationLexicalMatchedOperationCount: jevTelemetry.operationLexicalMatchedOperationCount,
          jevOperationLexicalTopScore: jevTelemetry.operationLexicalTopScore,
          jevActionCandidateCount: jevTelemetry.actionCandidateCount,
          jevActionCatalogSize: jevTelemetry.actionCatalogSize,
          jevActionCatalogMayBeBounded: jevTelemetry.actionCatalogMayBeBounded,
          jevEstimatedRequestBytes: jevTelemetry.estimatedRequestBytes,
          jevEvaluationCalls: jevTelemetry.evaluationCalls,
          jevProviderRequestCount: jevTelemetry.providerRequestCount,
          jevPlanningCalls: jevTelemetry.planningCalls,
          jevPlanningProviderRequestCount: jevTelemetry.planningProviderRequestCount,
          jevPlanningDurationMs: jevTelemetry.planningDurationMs,
          jevPlanningStepCount: jevTelemetry.planningStepCount,
          jevPlanningCandidateCount: jevTelemetry.planningCandidateCount,
          jevPlanningCandidateCatalogMayBeBounded: jevTelemetry.planningCandidateCatalogMayBeBounded,
          jevPlanningEstimatedRequestBytes: jevTelemetry.planningEstimatedRequestBytes,
          jevPlanningInputTokens: jevTelemetry.planningInputTokens,
          jevPlanningOutputTokens: jevTelemetry.planningOutputTokens,
          jevPlanningModels: jevTelemetry.planningModels,
        } : {}),
        ...(!jevTelemetry && 'evaluationCalls' in jevRoute && jevRoute.evaluationCalls !== undefined
          ? { jevEvaluationCalls: jevRoute.evaluationCalls } : {}),
        ...(!jevTelemetry && 'providerRequestCount' in jevRoute && jevRoute.providerRequestCount !== undefined
          ? { jevProviderRequestCount: jevRoute.providerRequestCount } : {}),
      });
    }
    if (jevRoute.kind === 'fallback') {
      appendAppLog('info', 'Jev chat route could not select a supported operation.', {
        ...requestContext,
        event: 'jev_chat_route_fallback',
        reason: jevRoute.reason,
      });
      if (jevRoute.reason === 'http_endpoint_required') {
        return presentHttpEndpointSelection({ options, messages, session, signal, publishResult });
      }
      if (jevRoute.reason === 'http_path_required') {
        appendAppLog('info', 'Schema-less HTTP read stopped for an explicit path or OpenAPI contract.', {
          ...requestContext,
          event: 'jev_chat_http_read_path_required',
        });
        return httpReadPathRequiredMessage();
      }
      if (jevRoute.reason === 'unsupported') {
        const reply = await textReplyFromModel(
          'ax_command_chat_jev_unsupported',
          jevUnsupportedChatReplyPrompt(options),
        );
        return reply ?? jevFallbackMessage('unsupported');
      }
      if (jevRoute.reason === 'service_error' || jevRoute.reason === 'uncertain' || jevRoute.reason === 'missing_context') {
        return jevFallbackMessage(jevRoute.reason);
      }
    }
    if (jevRoute.kind === 'reply') {
      const reply = await textReplyFromModel('ax_command_chat_jev_reply');
      return reply ?? '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (jevRoute.kind === 'previous_result') {
      const previousReadResult = options.previousReadResult;
      if (!previousReadResult || !options.decisionEngine) return jevFallbackMessage('missing_context');
      const transformStartedAt = Date.now();
      const transformed = await applyJevTableTransform({
        decisionEngine: options.decisionEngine,
        table: previousReadResult,
        userMessage: options.userMessage,
        mode: 'auto',
        abortSignal: signal,
      });
      appendAppLog('info', 'Jev previous-result transform decision recorded.', {
        ...requestContext,
        event: 'jev_chat_previous_result_transform',
        durationMs: Date.now() - transformStartedAt,
        status: transformed.status,
        ...(transformed.status === 'transformed' ? { rowCount: transformed.table.rows.length } : {}),
      });
      if (transformed.status === 'clarify') return transformed.message;
      if (transformed.status === 'unavailable') {
        return '이전 결과는 유지했지만 Jev가 변환 조건을 확인하지 못해 바꾸지 않았습니다. 조건을 조금 더 구체적으로 말해 주세요.';
      }
      const table = transformed.status === 'transformed' ? transformed.table : previousReadResult;
      options.onReadResult?.(boundedChatReadResult(table));
      return formatTableArtifact(table);
    }
    if (jevRoute.kind === 'clarify') return jevRoute.message;
    if (jevRoute.kind === 'parameterized') {
      appendAppLog('info', 'Jev selected a read operation but required values are missing.', {
        ...requestContext,
        event: 'jev_chat_read_needs_input',
        capabilityId: jevRoute.plan.capabilityId,
        requiredParameterCount: jevRoute.plan.requiredParameterPaths.length,
      });
      return missingReadValuesMessage(jevRoute.plan.requiredParameterPaths);
    }
    if (jevRoute.kind === 'command') {
      appendAppLog('info', 'Jev selected a bounded chat route.', {
        ...requestContext,
        event: 'jev_chat_route_selected',
        route: jevRoute.route,
        command: jevRoute.command.name,
        confidence: jevRoute.confidence,
        ...(jevRoute.tableTransform ? { tableTransform: jevRoute.tableTransform } : {}),
        ...(jevRoute.tableProjection ? { tableProjection: jevRoute.tableProjection } : {}),
        ...(jevRoute.readResultStyle ? { readResultStyle: jevRoute.readResultStyle } : {}),
        ...(jevRoute.command.name === 'capability.invoke' && typeof jevRoute.command.args.id === 'string'
          ? { capabilityId: jevRoute.command.args.id.slice(0, 256) }
          : {}),
      });
      const readAuthorization = readAuthorizationFor(jevRoute.command);
      const result = await executeChatCommand(options, jevRoute.command, {
        executionContext: AGENT_COMMAND_CONTEXT,
        userMessage: options.userMessage,
        workspaceSessionId: options.workspaceSessionId,
        currentWorkflowId: session.workflowId,
        abortSignal: signal,
        designToolContext: options.designToolContext,
        designToolContextFactory: options.designToolContextFactory,
        ...(readAuthorization ? { readAuthorization } : {}),
      });
      signal.throwIfAborted();
      const resultForLoop = publishResult(jevRoute.command.name, result, jevRoute.command);
      appendAppLog('info', 'Jev-selected chat route completed.', {
        ...requestContext,
        event: 'jev_chat_route_result',
        route: jevRoute.route,
        command: jevRoute.command.name,
        status: resultForLoop.status,
      });
      if (jevRoute.route === 'context_remember') {
        return hostFacingMessage(resultForLoop, '저장할 내용을 확인해 주세요. 아직 저장하지 않았습니다.');
      }
      if (jevRoute.command.name === 'workflow.run') {
        return hostFacingMessage(resultForLoop, '워크플로우 실행 요청을 처리하지 못했습니다.');
      }
      if (jevRoute.command.name === 'workflow.delete' && resultForLoop.status === 'ok') {
        return '현재 workflow를 삭제했습니다.';
      }
      if (jevRoute.command.name === 'workflow.update' && resultForLoop.status === 'ok') {
        return workflowUpdateSuccessMessage(resultForLoop);
      }
      if (jevRoute.command.name === 'job.propose') {
        return hostFacingMessage(resultForLoop, '업무 초안을 처리하지 못했습니다.');
      }
      if (jevRoute.command.name === 'workflow.create' && resultForLoop.status === 'ok') {
        return '수동 workflow를 저장했습니다. 자동 실행은 활성화되지 않았습니다.';
      }
      if (jevRoute.command.name === 'execution.enqueue_once'
        && (resultForLoop.status === 'ok' || resultForLoop.status === 'queued')) {
        return hostFacingMessage(resultForLoop, '일회 실행을 큐에 등록했습니다. 실행 상태에서 진행 상황을 확인해 주세요.');
      }
      // Execution status and host issues are deterministic facts. Do not pay
      // for an LLM paraphrase that could obscure the actual failure.
      let completedCommand = jevRoute.command;
      let completedResult = resultForLoop;
      let completedTableTransform = jevRoute.tableTransform;
      let completedTableProjection = jevRoute.tableProjection;
      let completedReadResultStyle = jevRoute.readResultStyle;
      const initialRead = jevRoute.route === 'capability_read'
        ? readAuthorizationFor(jevRoute.command)
        : undefined;
      if (initialRead && isRecoverableReadFailure(completedResult)) {
        const attempted = new Set<string>();
        const initialIdentity = readOperationIdentity(initialRead.capabilityId, initialRead.params);
        if (initialIdentity) attempted.add(initialIdentity);
        let failedCapabilityId = initialRead.capabilityId;

        while (isRecoverableReadFailure(completedResult)) {
          const failureKind = completedResult.issues.find((item) => item.failureKind)?.failureKind;
          const remainingHints = (readOperationHints ?? []).filter((hint) => {
            const identity = readOperationIdentity(hint.capabilityId, hint.params);
            return identity !== undefined && !attempted.has(identity);
          });
          if (remainingHints.length === 0) break;

          const recoveryStartedAt = Date.now();
          const recovery = await routeChatWithJev({
            decisionEngine: options.decisionEngine!,
            userMessage: options.decisionMessage ?? options.userMessage,
            sessionMemo: options.sessionMemo,
            workflowPolicy: session.workflowPolicy,
            readOperationHints: remainingHints,
            readOperationCatalogSize: remainingHints.length,
            readOperationCatalogMayBeBounded: readOperationCatalogMayBeBounded === true
              || remainingHints.length < (readOperationHints?.length ?? 0),
            readOperationSelectionMode: 'prepared_candidates',
            readRecoveryContext: {
              failedCapabilityId,
              status: completedResult.status,
              ...(failureKind ? { failureKind } : {}),
            },
            abortSignal: signal,
          });
          signal.throwIfAborted();
          const recoveryAuthorization = recovery.kind === 'command'
            && recovery.route === 'capability_read'
            ? readAuthorizationFor(recovery.command)
            : undefined;
          appendAppLog('info', 'Jev read recovery decision recorded.', {
            ...requestContext,
            event: 'jev_chat_read_recovery',
            durationMs: Date.now() - recoveryStartedAt,
            previousCapabilityId: failedCapabilityId,
            previousStatus: completedResult.status,
            candidateCount: remainingHints.length,
            outcome: recovery.kind === 'command' ? `${recovery.kind}:${recovery.route}` : recovery.kind,
            ...(recoveryAuthorization ? { selectedCapabilityId: recoveryAuthorization.capabilityId } : {}),
            ...(recovery.telemetry ? {
              jevEvaluationCalls: recovery.telemetry.evaluationCalls,
              jevProviderRequestCount: recovery.telemetry.providerRequestCount,
              jevEstimatedRequestBytes: recovery.telemetry.estimatedRequestBytes,
            } : {}),
          });

          if (recovery.kind === 'parameterized') {
            return missingReadValuesMessage(recovery.plan.requiredParameterPaths);
          }
          if (recovery.kind !== 'command' || recovery.route !== 'capability_read' || !recoveryAuthorization) break;

          const identity = readOperationIdentity(recoveryAuthorization.capabilityId, recoveryAuthorization.params);
          const selectedHint = remainingHints.find((hint) =>
            readOperationIdentity(hint.capabilityId, hint.params) === identity,
          );
          if (!identity || !selectedHint || attempted.has(identity)) break;
          attempted.add(identity);
          const retryResult = await executeChatCommand(options, recovery.command, {
            executionContext: AGENT_COMMAND_CONTEXT,
            userMessage: options.userMessage,
            workspaceSessionId: options.workspaceSessionId,
            currentWorkflowId: session.workflowId,
            abortSignal: signal,
            designToolContext: options.designToolContext,
            designToolContextFactory: options.designToolContextFactory,
            readAuthorization: recoveryAuthorization,
          });
          signal.throwIfAborted();
          completedCommand = recovery.command;
          completedResult = publishResult(recovery.command.name, retryResult, recovery.command);
          completedTableTransform = recovery.tableTransform;
          completedTableProjection = recovery.tableProjection;
          completedReadResultStyle = recovery.readResultStyle;
          failedCapabilityId = recoveryAuthorization.capabilityId;
          appendAppLog('info', 'Jev-selected alternative read completed.', {
            ...requestContext,
            event: 'jev_chat_read_recovery_result',
            capabilityId: recoveryAuthorization.capabilityId,
            status: completedResult.status,
          });
          if (completedResult.status === 'ok') break;
        }
      }
      if (completedResult.status !== 'ok') {
        return hostFacingMessage(completedResult, '요청을 처리하지 못했습니다.');
      }
      return successfulCommandReply(
        completedCommand,
        completedResult,
        options.userMessage,
        'ax_command_chat_jev_result',
        '작업은 처리했지만 결과 설명을 생성하지 못했습니다.',
        jevRoute.route,
        completedTableTransform,
        completedTableProjection,
        completedReadResultStyle,
      );
    }
  }
  return '요청을 안전한 실행 경로로 연결하지 못했습니다. Jev 연결과 요청의 대상·목표를 확인해 주세요.';
}

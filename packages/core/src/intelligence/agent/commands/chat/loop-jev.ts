import { thenTransform } from './read-recipe.js';
import { authoritativeRequestClarification } from '../../../decision/request-anchor.js';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import type { AxCommand, AxCommandResult } from '../schema.js';
import { jevUnsupportedChatReplyPrompt } from './protocol.js';
import { boundedChatReadResult, formatTableArtifact, hostFacingMessage } from './result.js';
import { applyJevTableTransform } from './jev-table-transform.js';
import { planPreviousTableExport } from './jev-table-export.js';
import { httpReadPathRequiredMessage } from './connection-selection/http-endpoint-selection.js';
import { routeChatWithJev, type JevChatRouterInput, type JevChatRouterResult } from './jev-router.js';
import type { JevChatRouterTelemetry } from './jev-router-contract.js';
import { appendAppLog } from '../../../../persistence/paths/app-log.js';
import { chatReadAuthorizationFor, type ChatReadAuthorization } from './read-authorization.js';
import type { ChatReplies } from './loop-replies.js';
import {
  chatRequestContext,
  executeScopedChatCommand,
  isRecoverableReadFailure,
  jevFallbackMessage,
  missingReadValuesMessage,
  partialPreviousResultCalculation,
  PARTIAL_PREVIOUS_RESULT_NOTE,
  presentHttpEndpointSelection,
  readOperationIdentity,
  workflowUpdateSuccessMessage,
  type CommandChatLoopContext,
} from './loop-shared.js';

type JevRoute<K extends JevChatRouterResult['kind']> = Extract<JevChatRouterResult, { kind: K }>;

/** The read catalog snapshot for this turn, shared by the first route and any read recovery. */
interface ReadCatalog {
  hints?: readonly JevReadOperationHint[];
  size?: number;
  mayBeBounded?: boolean;
  mode?: JevChatRouterInput['readOperationSelectionMode'];
  lexicalMatchedOperationCount?: number;
  lexicalTopScore?: number;
  preparationMs: number;
}

interface JevTurn {
  context: CommandChatLoopContext;
  replies: ChatReplies;
  catalog: ReadCatalog;
  requestContext: { requestId?: string };
}

function prepareReadCatalog({ options }: CommandChatLoopContext): ReadCatalog {
  const startedAt = Date.now();
  const selection = options.resolveReadOperationSelection?.();
  return {
    preparationMs: Date.now() - startedAt,
    hints: selection?.hints ?? options.readOperationHints,
    size: selection?.totalCount ?? options.readOperationCatalogSize,
    mayBeBounded: selection?.catalogMayBeBounded ?? options.readOperationCatalogMayBeBounded,
    mode: selection?.mode ?? options.readOperationSelectionMode,
    lexicalMatchedOperationCount: selection?.lexicalMatchedOperationCount
      ?? options.readOperationLexicalMatchedOperationCount,
    lexicalTopScore: selection?.lexicalTopScore ?? options.readOperationLexicalTopScore,
  };
}

/** Router input fields shared by the first route and read recovery. */
function baseRouterInput({ options, messages, session, signal }: CommandChatLoopContext) {
  return {
    decisionEngine: options.decisionEngine!,
    userMessage: options.requestAnchor!.text,
    requestAnchor: options.requestAnchor,
    requestBudget: options.requestBudget,
    conversationHistory: messages.slice(0, -1).slice(-6),
    sessionMemo: options.sessionMemo,
    workflowPolicy: session.workflowPolicy,
    abortSignal: signal,
  } satisfies Partial<JevChatRouterInput>;
}

function telemetryLogFields(telemetry: JevChatRouterTelemetry): Record<string, unknown> {
  return {
    jevModel: telemetry.model,
    jevInputTokens: telemetry.inputTokens,
    jevOutputTokens: telemetry.outputTokens,
    jevSelectedRoute: telemetry.selectedRoute,
    jevRouteConfidence: telemetry.routeConfidence,
    jevSelectedToolCount: telemetry.selectedToolCount,
    jevActionCandidateSelected: telemetry.actionCandidateSelected,
    jevQuestionIds: telemetry.questionIds,
    jevRouteCandidateCount: telemetry.routeCandidateCount,
    jevOperationCandidateCount: telemetry.operationCandidateCount,
    jevOperationCatalogSize: telemetry.operationCatalogSize,
    jevOperationCatalogMayBeBounded: telemetry.operationCatalogMayBeBounded,
    jevOperationSelectionMode: telemetry.operationSelectionMode,
    jevOperationLexicalMatchedOperationCount: telemetry.operationLexicalMatchedOperationCount,
    jevOperationLexicalTopScore: telemetry.operationLexicalTopScore,
    jevActionCandidateCount: telemetry.actionCandidateCount,
    jevActionCatalogSize: telemetry.actionCatalogSize,
    jevActionCatalogMayBeBounded: telemetry.actionCatalogMayBeBounded,
    jevEstimatedRequestBytes: telemetry.estimatedRequestBytes,
    jevEvaluationCalls: telemetry.evaluationCalls,
    jevProviderRequestCount: telemetry.providerRequestCount,
    jevPlanningCalls: telemetry.planningCalls,
    jevPlanningProviderRequestCount: telemetry.planningProviderRequestCount,
    jevPlanningDurationMs: telemetry.planningDurationMs,
    jevPlanningStepCount: telemetry.planningStepCount,
    jevPlanningCandidateCount: telemetry.planningCandidateCount,
    jevPlanningCandidateCatalogMayBeBounded: telemetry.planningCandidateCatalogMayBeBounded,
    jevPlanningEstimatedRequestBytes: telemetry.planningEstimatedRequestBytes,
    jevPlanningInputTokens: telemetry.planningInputTokens,
    jevPlanningOutputTokens: telemetry.planningOutputTokens,
    jevPlanningModels: telemetry.planningModels,
  };
}

async function routeFirstTurn(turn: JevTurn): Promise<JevChatRouterResult> {
  const { context, catalog, requestContext } = turn;
  const { options, session } = context;
  const startedAt = Date.now();
  let route: JevChatRouterResult = { kind: 'fallback', reason: 'service_error' };
  let telemetry: JevChatRouterTelemetry | undefined;
  let outcome = 'error';
  try {
    route = await routeChatWithJev({
      ...baseRouterInput(context),
      currentWorkflowId: session.workflowId,
      currentWorkflowVersion: options.currentWorkflowVersion,
      currentWorkflowSteps: options.currentWorkflowSteps,
      currentWorkflowOutputs: options.currentWorkflowOutputs,
      hasWorkspaceSession: Boolean(options.workspaceSessionId),
      connectedConnectors: options.connectedConnectors,
      actionInputValues: options.commandInputValues,
      httpEndpoints: options.httpEndpoints,
      readOperationHints: catalog.hints,
      readOperationCatalogSize: catalog.size,
      readOperationCatalogMayBeBounded: catalog.mayBeBounded,
      readOperationSelectionMode: catalog.mode,
      readOperationLexicalMatchedOperationCount: catalog.lexicalMatchedOperationCount,
      readOperationLexicalTopScore: catalog.lexicalTopScore,
      previousReadResult: options.previousReadResult,
      workspaceSources: options.workspaceSources,
      resolveWorkspaceSources: options.resolveWorkspaceSources,
    });
    if (route.presentation) options.onPresentation?.(route.presentation);
    telemetry = route.telemetry;
    outcome = route.kind === 'fallback'
      ? `fallback:${route.reason}`
      : route.kind === 'request_rejected' ? `request_rejected:${route.failure.code}`
      : `${route.kind}:${route.route}`;
  } finally {
    appendAppLog('info', 'Jev chat route timing recorded.', {
      ...requestContext,
      event: 'jev_chat_route_timing',
      durationMs: Date.now() - startedAt,
      readOperationCatalogPreparationMs: catalog.preparationMs,
      outcome,
      readOperationHintCount: catalog.hints?.length ?? 0,
      readOperationCatalogSize: catalog.size,
      readOperationCatalogMayBeBounded: catalog.mayBeBounded,
      readOperationSelectionMode: catalog.mode,
      readOperationLexicalMatchedOperationCount: catalog.lexicalMatchedOperationCount,
      readOperationLexicalTopScore: catalog.lexicalTopScore,
      ...(telemetry ? telemetryLogFields(telemetry) : {}),
      ...(!telemetry && 'evaluationCalls' in route && route.evaluationCalls !== undefined
        ? { jevEvaluationCalls: route.evaluationCalls } : {}),
      ...(!telemetry && 'providerRequestCount' in route && route.providerRequestCount !== undefined
        ? { jevProviderRequestCount: route.providerRequestCount } : {}),
    });
  }
  return route;
}

async function fallbackRoute(turn: JevTurn, route: JevRoute<'fallback'>): Promise<string> {
  const { context, requestContext } = turn;
  appendAppLog('info', 'Jev chat route could not select a supported operation.', {
    ...requestContext,
    event: 'jev_chat_route_fallback',
    reason: route.reason,
  });
  if (route.reason === 'http_endpoint_required') return presentHttpEndpointSelection(context);
  if (route.reason === 'http_path_required') {
    appendAppLog('info', 'Schema-less HTTP read stopped for an explicit path or OpenAPI contract.', {
      ...requestContext,
      event: 'jev_chat_http_read_path_required',
    });
    return httpReadPathRequiredMessage();
  }
  if (route.reason === 'unsupported') {
    const reply = await turn.replies.textReplyFromModel(
      'ax_command_chat_jev_unsupported',
      jevUnsupportedChatReplyPrompt(context.options),
    );
    return reply ?? jevFallbackMessage('unsupported');
  }
  return jevFallbackMessage(route.reason);
}

async function replyRoute(turn: JevTurn): Promise<string> {
  const reply = await turn.replies.textReplyFromModel('ax_command_chat_jev_reply');
  if (!reply) return '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  // The model only sees the bounded table text; never let a computed figure read as a full-data total.
  return partialPreviousResultCalculation(turn.context.options) ? `${reply}\n\n${PARTIAL_PREVIOUS_RESULT_NOTE}` : reply;
}

async function previousResultRoute(turn: JevTurn): Promise<string> {
  const { context, requestContext } = turn;
  const { options, signal, publishResult } = context;
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
  if (transformed.status === 'export_xlsx') {
    const exportPlan = await planPreviousTableExport({ table: previousReadResult,
      request: options.userMessage, decisionEngine: options.decisionEngine, signal });
    appendAppLog('info', 'Previous-table export plan checked.', { ...requestContext,
      event: 'jev_chat_table_export_plan', evaluationCalls: exportPlan.evaluationCalls,
      providerRequestCount: exportPlan.providerRequestCount, requestBytes: exportPlan.requestBytes,
      usage: exportPlan.usage, accepted: Boolean(exportPlan.command) });
    if (!exportPlan.command) return exportPlan.message!;
    options.onPresentation?.({ title: 'Excel 저장 계획 검사', inputMode: 'individual', inputs: [], actions: [],
      blocks: [{ type: 'decision', label: '입력·요구 충족·범위', value: 'Host 입력 검사 및 Jev 검토 통과' },
        { type: 'steps', title: '의존 순서', items: ['현재 표 → Excel 산출물 저장'] },
        { type: 'note', text: '실행 완료가 아닙니다. 현재 표만 저장하며 원본 재조회나 외부 발송은 하지 않습니다.' }] });
    const result = await executeScopedChatCommand(context, exportPlan.command);
    signal.throwIfAborted();
    publishResult(exportPlan.command.name, result, exportPlan.command);
    return result.status === 'queued' ? '현재 표의 Excel 저장을 실행 큐에 등록했습니다. 파일 생성 결과는 실행 결과에서 확인합니다.'
      : 'Excel 저장을 시작하지 못했습니다. 실행 결과를 확인해 주세요.';
  }
  if (transformed.status === 'clarify') return transformed.message;
  if (transformed.status === 'unavailable') {
    return '이전 결과는 유지했지만 Jev가 변환 조건을 확인하지 못해 바꾸지 않았습니다. 조건을 조금 더 구체적으로 말해 주세요.';
  }
  const table = transformed.status === 'transformed' ? transformed.table : previousReadResult;
  options.onReadResult?.(boundedChatReadResult(table));
  // Shaping an earlier answer again repeats that answer's recipe, then this shaping.
  options.onReadRecipe?.(options.previousReadRecipe && transformed.status === 'transformed'
    ? thenTransform(options.previousReadRecipe, transformed.expression)
    : options.previousReadRecipe);
  return formatTableArtifact(table);
}

async function parameterizedRoute(turn: JevTurn, route: JevRoute<'parameterized'>): Promise<string> {
  appendAppLog('info', 'Jev selected a read operation but required values are missing.', {
    ...turn.requestContext,
    event: 'jev_chat_read_needs_input',
    capabilityId: route.plan.capabilityId,
    requiredParameterCount: route.plan.requiredParameterPaths.length,
  });
  return missingReadValuesMessage(route.plan.requiredParameterPaths);
}

/** Lifecycle commands report their host status deterministically instead of via an LLM paraphrase. */
function lifecycleCommandReply(route: JevRoute<'command'>, result: AxCommandResult): string | undefined {
  const name = route.command.name;
  if (route.route === 'context_remember') return hostFacingMessage(result, '저장할 내용을 확인해 주세요. 아직 저장하지 않았습니다.');
  if (name === 'workflow.run') return hostFacingMessage(result, '워크플로우 실행 요청을 처리하지 못했습니다.');
  if (name === 'workflow.delete' && result.status === 'ok') return '현재 workflow를 삭제했습니다.';
  if (name === 'workflow.update' && result.status === 'ok') return workflowUpdateSuccessMessage(result);
  if (name === 'job.propose') return hostFacingMessage(result, '업무 초안을 처리하지 못했습니다.');
  if (name === 'workflow.create' && result.status === 'ok') return '수동 workflow를 저장했습니다. 자동 실행은 활성화되지 않았습니다.';
  if (name === 'execution.enqueue_once' && (result.status === 'ok' || result.status === 'queued')) {
    return hostFacingMessage(result, '일회 실행을 큐에 등록했습니다. 실행 상태에서 진행 상황을 확인해 주세요.');
  }
  return undefined;
}

interface CompletedRead {
  command: AxCommand;
  result: AxCommandResult;
  route: Pick<JevRoute<'command'>, 'tableTransform' | 'tableProjection' | 'readResultStyle'>;
}

/**
 * After a recoverable read failure, Jev may choose a different cataloged read.
 * Each candidate runs at most once and only with a catalog-backed authorization.
 */
async function recoverFailedRead(
  turn: JevTurn,
  initialRead: ChatReadAuthorization,
  completed: CompletedRead,
): Promise<CompletedRead | string> {
  const { context, catalog, requestContext } = turn;
  const { options, signal, publishResult } = context;
  const attempted = new Set<string>();
  const initialIdentity = readOperationIdentity(initialRead.capabilityId, initialRead.params);
  if (initialIdentity) attempted.add(initialIdentity);
  let failedCapabilityId = initialRead.capabilityId;
  let current = completed;

  while (isRecoverableReadFailure(current.result)) {
    signal.throwIfAborted();
    const failedResult = current.result;
    const failureKind = failedResult.issues.find((item) => item.failureKind)?.failureKind;
    const remainingHints = (catalog.hints ?? []).filter((hint) => {
      const identity = readOperationIdentity(hint.capabilityId, hint.params);
      return identity !== undefined && !attempted.has(identity);
    });
    if (remainingHints.length === 0) break;

    const recoveryStartedAt = Date.now();
    const recovery = await routeChatWithJev({
      ...baseRouterInput(context),
      readOperationHints: remainingHints,
      readOperationCatalogSize: remainingHints.length,
      readOperationCatalogMayBeBounded: catalog.mayBeBounded === true
        || remainingHints.length < (catalog.hints?.length ?? 0),
      readOperationSelectionMode: 'prepared_candidates',
      readRecoveryContext: {
        failedCapabilityId,
        status: failedResult.status,
        ...(failureKind ? { failureKind } : {}),
      },
    });
    signal.throwIfAborted();
    const recoveryAuthorization = recovery.kind === 'command' && recovery.route === 'capability_read'
      ? chatReadAuthorizationFor(recovery.command, { hints: remainingHints })
      : undefined;
    appendAppLog('info', 'Jev read recovery decision recorded.', {
      ...requestContext,
      event: 'jev_chat_read_recovery',
      durationMs: Date.now() - recoveryStartedAt,
      previousCapabilityId: failedCapabilityId,
      previousStatus: failedResult.status,
      candidateCount: remainingHints.length,
      outcome: recovery.kind === 'command' ? `${recovery.kind}:${recovery.route}` : recovery.kind,
      ...(recoveryAuthorization ? { selectedCapabilityId: recoveryAuthorization.capabilityId } : {}),
      ...(recovery.telemetry ? {
        jevEvaluationCalls: recovery.telemetry.evaluationCalls,
        jevProviderRequestCount: recovery.telemetry.providerRequestCount,
        jevEstimatedRequestBytes: recovery.telemetry.estimatedRequestBytes,
      } : {}),
    });

    if (recovery.kind === 'request_rejected') {
      options.onRequestRejected?.(recovery.failure);
      return authoritativeRequestClarification(recovery.failure);
    }
    if (recovery.kind === 'parameterized') return missingReadValuesMessage(recovery.plan.requiredParameterPaths);
    if (recovery.kind !== 'command' || recovery.route !== 'capability_read' || !recoveryAuthorization) break;

    const identity = readOperationIdentity(recoveryAuthorization.capabilityId, recoveryAuthorization.params);
    const selectedHint = remainingHints.find((hint) =>
      readOperationIdentity(hint.capabilityId, hint.params) === identity,
    );
    if (!identity || !selectedHint || attempted.has(identity)) break;
    attempted.add(identity);
    const retryResult = await executeScopedChatCommand(context, recovery.command, recoveryAuthorization);
    signal.throwIfAborted();
    current = {
      command: recovery.command,
      result: publishResult(recovery.command.name, retryResult, recovery.command),
      route: recovery,
    };
    failedCapabilityId = recoveryAuthorization.capabilityId;
    appendAppLog('info', 'Jev-selected alternative read completed.', {
      ...requestContext,
      event: 'jev_chat_read_recovery_result',
      capabilityId: recoveryAuthorization.capabilityId,
      status: current.result.status,
    });
    if (current.result.status === 'ok') break;
  }
  return current;
}

async function commandRoute(turn: JevTurn, route: JevRoute<'command'>): Promise<string> {
  const { context, catalog, requestContext } = turn;
  const { options, signal, publishResult } = context;
  appendAppLog('info', 'Jev selected a bounded chat route.', {
    ...requestContext,
    event: 'jev_chat_route_selected',
    route: route.route,
    command: route.command.name,
    confidence: route.confidence,
    ...(route.tableTransform ? { tableTransform: route.tableTransform } : {}),
    ...(route.tableProjection ? { tableProjection: route.tableProjection } : {}),
    ...(route.readResultStyle ? { readResultStyle: route.readResultStyle } : {}),
    ...(route.command.name === 'capability.invoke' && typeof route.command.args.id === 'string'
      ? { capabilityId: route.command.args.id.slice(0, 256) }
      : {}),
  });
  // Only a read traceable to the catalog (or a user-typed GET path) gets a read authorization.
  const readAuthorization = chatReadAuthorizationFor(route.command, {
    hints: catalog.hints,
    userText: options.requestAnchor?.text ?? options.userMessage,
  });
  const result = await executeScopedChatCommand(context, route.command, readAuthorization);
  signal.throwIfAborted();
  const resultForLoop = publishResult(route.command.name, result, route.command);
  appendAppLog('info', 'Jev-selected chat route completed.', {
    ...requestContext,
    event: 'jev_chat_route_result',
    route: route.route,
    command: route.command.name,
    status: resultForLoop.status,
  });
  const lifecycleReply = lifecycleCommandReply(route, resultForLoop);
  if (lifecycleReply !== undefined) return lifecycleReply;

  let completed: CompletedRead = { command: route.command, result: resultForLoop, route };
  if (route.route === 'capability_read' && readAuthorization && isRecoverableReadFailure(resultForLoop)) {
    const recovered = await recoverFailedRead(turn, readAuthorization, completed);
    if (typeof recovered === 'string') return recovered;
    completed = recovered;
  }
  // Execution status and host issues are deterministic facts. Do not pay
  // for an LLM paraphrase that could obscure the actual failure.
  if (completed.result.status !== 'ok') {
    return hostFacingMessage(completed.result, '요청을 처리하지 못했습니다.');
  }
  return turn.replies.successfulCommandReply({
    command: completed.command,
    result: completed.result,
    userIntent: options.userMessage,
    phase: 'ax_command_chat_jev_result',
    fallback: '작업은 처리했지만 결과 설명을 생성하지 못했습니다.',
    route: route.route,
    tableTransform: completed.route.tableTransform,
    tableProjection: completed.route.tableProjection,
    readResultStyle: completed.route.readResultStyle,
    llmRequired: route.requestPlan?.response.llmRequired,
  });
}

type JevRouteHandlers = {
  [K in JevChatRouterResult['kind']]: (turn: JevTurn, route: JevRoute<K>) => Promise<string>;
};

const JEV_ROUTE_HANDLERS: JevRouteHandlers = {
  request_rejected: async ({ context }, route) => {
    context.options.onRequestRejected?.(route.failure);
    return authoritativeRequestClarification(route.failure);
  },
  fallback: fallbackRoute,
  reply: replyRoute,
  previous_result: previousResultRoute,
  clarify: async (_turn, route) => route.message,
  parameterized: parameterizedRoute,
  command: commandRoute,
};

/** Route one ordinary chat turn through Jev and execute the selected bounded host command. */
export async function runJevChatTurn(context: CommandChatLoopContext, replies: ChatReplies): Promise<string> {
  const turn: JevTurn = {
    context,
    replies,
    catalog: prepareReadCatalog(context),
    requestContext: chatRequestContext(context.options),
  };
  const route = await routeFirstTurn(turn);
  const handler = JEV_ROUTE_HANDLERS[route.kind] as (turn: JevTurn, route: JevChatRouterResult) => Promise<string>;
  return handler(turn, route);
}

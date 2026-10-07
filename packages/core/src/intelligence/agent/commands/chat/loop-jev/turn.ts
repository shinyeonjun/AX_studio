import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';
import { routeChatWithJev, type JevChatRouterInput, type JevChatRouterResult } from '../jev-router.js';
import type { JevChatRouterTelemetry } from '../jev-router-contract.js';
import { appendAppLog } from '../../../../../persistence/paths/app-log.js';
import type { ChatReplies } from '../loop-replies.js';
import type { CommandChatLoopContext } from '../loop-shared.js';

export type JevRoute<K extends JevChatRouterResult['kind']> = Extract<JevChatRouterResult, { kind: K }>;

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

export interface JevTurn {
  context: CommandChatLoopContext;
  replies: ChatReplies;
  catalog: ReadCatalog;
  requestContext: { requestId?: string };
}

export function prepareReadCatalog({ options }: CommandChatLoopContext): ReadCatalog {
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
export function baseRouterInput({ options, messages, session, signal }: CommandChatLoopContext) {
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

export async function routeFirstTurn(turn: JevTurn): Promise<JevChatRouterResult> {
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

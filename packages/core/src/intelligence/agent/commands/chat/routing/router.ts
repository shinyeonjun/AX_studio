import { AuthoritativeRequestError, resolveAuthoritativeRequestAnchor, guardAuthoritativeRequestDecisions } from '../../../../decision/request-anchor.js';
import {
  decisionProviderRequestCountFromError,
  type ChoiceDecisionAnswer,
  type DecisionAnswer,
  type DecisionInstruction,
  type DecisionQuestion,
} from '../../../../../contracts/decision.js';
import { boundDecisionString } from '../../../../decision/context.js';
import { choiceAnswerConfidence } from '../../../../decision/confidence.js';
import { availableCapabilities } from '../../../../../catalog/capability-graph.js';
import { selectJevReadOperationHints } from '../../../../decision/read-operation-catalog.js';
import { selectJevWorkflowTriggerHints } from '../planning/workflow-proposal.js';
import { selectJevActionHints } from '../shared/action-catalog.js';
import { buildJevDecisionRequest } from './decision-request.js';
import { JEV_CHAT_ROUTE_CRITERIA, type JevChatRouteName } from './route-criteria.js';
import { deriveJevRequestFeatures, type JevRequestFeatures } from '../shared/request-features.js';
import {
  parseParallelToolSelection,
  type JevParallelToolSelection,
} from './parallel-tool-selection.js';
import type { JevChatRequestPlan } from '../shared/request-plan.js';
import type { JevChatRouterInput, JevChatRouterResult } from './router-contract.js';
export type { JevChatRouterInput, JevChatRouterResult } from './router-contract.js';
import { choiceAnswer, fallback } from './router-command.js';
import { JevRouterTelemetryTracker } from './router-telemetry.js';
import { dispatchJevRoute, type JevFollowupEvaluator } from './router-routes.js';
export { rankReadHintsByRelevance } from './router-routes.js';

/** Lexical request cues may only break ties below this Jev route confidence. */
const JEV_ROUTE_TIE_BREAK_MAX_CONFIDENCE = 0.6;

const TOOL_SELECTION_ROUTES = new Set<JevChatRouteName>([
  'answer', 'capability_read', 'execution_enqueue_once', 'workflow_create', 'job_propose',
]);

/** Destructive routes require Jev's chosen route to also be its most probable one. */
function isDominantRouteChoice(answer: ChoiceDecisionAnswer, route: string): boolean {
  const chosen = answer.probabilities[route];
  if (chosen === undefined) return choiceAnswerConfidence(answer, route) >= 0.5;
  return Number.isFinite(chosen) && chosen >= 0.5
    && Object.entries(answer.probabilities).every(([choice, probability]) => choice === route || !(probability >= chosen));
}

interface ToolSelectionState {
  route: JevChatRouteName;
  selectedToolIds: Set<string>;
  hasSelectedWriteTools: boolean;
}

/**
 * Host normalization of Jev's parallel tool selection. It may only remove tools
 * or keep work in chat; it never adds a tool, escalates a read to execution, or
 * replaces a confident Jev route. Returns a fallback when the selection contradicts the route.
 */
function normalizeToolSelection(input: {
  route: JevChatRouteName;
  confidence: number;
  routerInput: JevChatRouterInput;
  requestFeatures: JevRequestFeatures;
  explicitAction?: ChoiceDecisionAnswer;
  toolSelection?: JevParallelToolSelection;
  requestPlan?: JevChatRequestPlan;
  telemetry: JevRouterTelemetryTracker;
}): ToolSelectionState | JevChatRouterResult {
  const { toolSelection, requestPlan, telemetry, requestFeatures } = input;
  let route = input.route;
  const selectedToolIds = new Set(toolSelection?.kind === 'selected'
    ? toolSelection.operationDecisions.filter(({ selected }) => selected).map(({ id }) => id)
    : []);
  const hasWrites = () => [...selectedToolIds].some((id) => id.startsWith('write:'));
  const keepReplyInChat = () => {
    if (toolSelection?.kind === 'selected') toolSelection.needsNaturalLanguageAnswer = true;
    if (requestPlan) requestPlan.response.llmRequired = true;
  };
  if (toolSelection?.kind === 'selected') {
    if (hasWrites() && route === 'capability_read' && input.explicitAction?.choice === 'execute_now') {
      // "Read X and send it to Slack": Jev picked a read route but also selected a write
      // and explicitly confirmed execution intent. Plan it as a one-off run; the planner,
      // the host confirmation card and external-send approval still gate every write.
      route = 'execution_enqueue_once';
      telemetry.update({ selectedRoute: route });
    } else if (hasWrites() && (route === 'capability_read'
      || (route === 'answer' && input.explicitAction?.choice !== 'execute_now'))) {
      // Without Jev-confirmed execution intent a read route never executes writes: they
      // are dropped when Jev says not to execute (e.g. drafting text in chat), otherwise
      // it fails closed. A conversational answer without confirmed intent stays in chat.
      if (route === 'capability_read' && input.explicitAction?.choice !== 'do_not_execute') {
        return fallback('uncertain', 'read_route_selected_write_tool');
      }
      for (const id of [...selectedToolIds]) {
        if (id.startsWith('write:')) selectedToolIds.delete(id);
      }
      keepReplyInChat();
    }
    telemetry.update({ selectedToolCount: selectedToolIds.size, actionCandidateSelected: hasWrites() });
  }
  const hasSelectedWriteTools = hasWrites();
  // Lexical cues were already sent to Jev as request features; here they only break ties.
  if (route === 'answer' && !hasSelectedWriteTools && selectedToolIds.size > 0
    && requestFeatures.previous_context_reference_cue && requestFeatures.calculation_or_summary_cue
    && (input.routerInput.conversationHistory ?? []).some(({ role }) => role === 'assistant')) {
    // Jev chose a conversational answer about earlier results; do not re-read sources.
    selectedToolIds.clear();
    keepReplyInChat();
    telemetry.update({ selectedToolCount: 0, actionCandidateSelected: false });
  }
  if (input.confidence < JEV_ROUTE_TIE_BREAK_MAX_CONFIDENCE && input.routerInput.previousReadResult
    && !hasSelectedWriteTools && requestFeatures.table_transform_cue && !requestFeatures.fresh_read_cue
    && (route === 'answer' || route === 'capability_read')) {
    selectedToolIds.clear();
    route = 'previous_result';
    telemetry.update({ selectedRoute: route, selectedToolCount: 0, actionCandidateSelected: false });
  }
  return { route, selectedToolIds, hasSelectedWriteTools };
}

/**
 * Uses Jev only to select a closed-set read/action route. The caller owns the
 * request deadline and cancellation across the initial decision and follow-ups.
 * The returned command is still validated and executed by AxCommandService;
 * Jev never supplies a command name, connector method, SQL, URL, or workflow payload.
 */
export async function routeChatWithJev(input: JevChatRouterInput): Promise<JevChatRouterResult> {
  input.abortSignal?.throwIfAborted();
  try {
    const anchor = resolveAuthoritativeRequestAnchor(input.userMessage, input.requestAnchor,
      { catalogRevision: input.connectionRevision }, input.requestBudget);
    input = { ...input, requestAnchor: anchor,
      decisionEngine: guardAuthoritativeRequestDecisions(input.decisionEngine, anchor, input.requestBudget) };
  } catch (error) {
    if (!(error instanceof AuthoritativeRequestError)) throw error;
    return { kind: 'request_rejected', failure: error.failure };
  }
  const requestFeatures = deriveJevRequestFeatures(input.userMessage);
  // The index has already selected safe candidates; do not apply a second
  // lexical filter that could hide a semantic match from Jev.
  const indexedHints = input.readOperationHints ?? [];
  const operationHints = input.readOperationSelectionMode
    ? indexedHints
    : selectJevReadOperationHints(indexedHints, input.userMessage);
  const operationCatalogSize = input.readOperationCatalogSize ?? input.readOperationHints?.length ?? 0;
  const operationCatalogMayBeBounded = input.readOperationCatalogMayBeBounded
    ?? operationCatalogSize > operationHints.length;
  const readRecovery = input.readRecoveryContext !== undefined;
  // Recovery is intentionally limited to reads; do not expose write or workflow choices.
  const connectedConnectors = input.connectedConnectors ?? [];
  // Share one merged catalog so action and trigger selectors avoid duplicate scans and see the same snapshot.
  const capabilitySnapshot = readRecovery ? [] : availableCapabilities([...connectedConnectors]);
  const actionSelection = readRecovery
    ? { hints: [], catalogSize: 0, catalogMayBeBounded: false }
    : selectJevActionHints(connectedConnectors, capabilitySnapshot);
  const workflowTriggerHints = readRecovery
    ? []
    : selectJevWorkflowTriggerHints(connectedConnectors, capabilitySnapshot);
  const transformCapabilities = capabilitySnapshot.filter((capability) =>
    capability.connector === 'transform' && capability.kind === 'read' && capability.id !== 'transform.evaluate',
  );
  const routeCatalog: Record<string, DecisionInstruction> = readRecovery
    ? { answer: JEV_CHAT_ROUTE_CRITERIA.answer, capability_read: JEV_CHAT_ROUTE_CRITERIA.capability_read }
    : { ...JEV_CHAT_ROUTE_CRITERIA };
  if (!input.previousReadResult || readRecovery) delete routeCatalog.previous_result;
  let telemetry: JevRouterTelemetryTracker | undefined;
  try {
    const {
      state,
      questions,
      routeCriteria,
      operationCandidateCount,
      parallelToolCandidates,
    } = buildJevDecisionRequest({
      userMessage: input.userMessage,
      requestFeatures,
      conversationHistory: input.conversationHistory,
      routeCatalog,
      currentWorkflowId: readRecovery ? undefined : input.currentWorkflowId,
      currentWorkflowSteps: readRecovery ? undefined : input.currentWorkflowSteps,
      hasWorkspaceSession: readRecovery ? false : input.hasWorkspaceSession,
      sessionMemo: input.sessionMemo,
      workflowPolicy: input.workflowPolicy,
      connectedConnectors: readRecovery ? [] : input.connectedConnectors,
      workflowTriggerHints,
      httpEndpoints: readRecovery ? [] : input.httpEndpoints,
      readOperationHints: operationHints,
      readOperationCatalogSize: operationCatalogSize,
      readOperationCatalogMayBeBounded: operationCatalogMayBeBounded,
      actionSelection,
      transformCapabilities: readRecovery ? [] : transformCapabilities,
      readRecoveryContext: input.readRecoveryContext,
      previousReadResult: input.previousReadResult,
      pastSourceChoices: input.pastSourceChoices,
    });
    const tracker = new JevRouterTelemetryTracker({
      questions,
      routeCandidateCount: Object.keys(routeCriteria).length,
      operationCandidateCount,
      operationCatalogSize,
      operationCatalogMayBeBounded,
      actionCandidateCount: actionSelection.hints.length,
      actionCatalogSize: actionSelection.catalogSize,
      actionCatalogMayBeBounded: actionSelection.catalogMayBeBounded,
      operationSelectionMode: input.readOperationSelectionMode,
      operationLexicalMatchedOperationCount: input.readOperationLexicalMatchedOperationCount,
      operationLexicalTopScore: input.readOperationLexicalTopScore,
    });
    telemetry = tracker;
    tracker.evaluationCalls += 1;
    const evaluation = await input.decisionEngine.evaluate({
      state,
      questions,
      signal: input.abortSignal,
    });
    input.abortSignal?.throwIfAborted();
    tracker.recordInitial(evaluation, state);
    let requestPlan: JevChatRequestPlan | undefined;
    const withTelemetry = (result: JevChatRouterResult): JevChatRouterResult => ({
      ...result,
      ...(requestPlan ? { requestPlan } : {}),
      ...(tracker.telemetry ? { telemetry: tracker.telemetry } : {}),
    });
    const evaluateFollowup: JevFollowupEvaluator = async (
      followupState: unknown,
      followupQuestions: Record<string, DecisionQuestion>,
    ) => {
      input.abortSignal?.throwIfAborted();
      tracker.evaluationCalls += 1;
      const followup = await input.decisionEngine.evaluate({
        state: followupState,
        questions: followupQuestions,
        signal: input.abortSignal,
      });
      input.abortSignal?.throwIfAborted();
      tracker.recordFollowup(followup, followupState, followupQuestions);
      return followup;
    };

    const routeAnswer = choiceAnswer(evaluation.answers.route);
    if (!routeAnswer || !Object.prototype.hasOwnProperty.call(routeCriteria, routeAnswer.choice)) {
      return withTelemetry(fallback('unsupported'));
    }
    const route = routeAnswer.choice as JevChatRouteName;
    const confidence = choiceAnswerConfidence(routeAnswer, route);
    tracker.update({ selectedRoute: route, routeConfidence: confidence });
    const explicitAction = choiceAnswer(evaluation.answers.explicit_execution_now);
    const updateAddsSteps = choiceAnswer(evaluation.answers.explicit_workflow_step_addition)?.choice === 'add_now';
    let toolSelection: JevParallelToolSelection | undefined;
    if (TOOL_SELECTION_ROUTES.has(route) || (route === 'workflow_update' && updateAddsSteps)) {
      toolSelection = parseParallelToolSelection({
        candidates: parallelToolCandidates,
        answers: evaluation.answers,
        telemetry: {
          evaluationCalls: 1,
          providerRequestCount: evaluation.providerRequestCount ?? 1,
          estimatedRequestBytes: tracker.firstPassRequestBytes,
          candidateCount: parallelToolCandidates.length,
        },
      });
      if (toolSelection.kind === 'clarify') {
        if (route === 'capability_read' && toolSelection.reason === 'no_answer_or_tool') {
          return withTelemetry(fallback('missing_context'));
        }
        if (route === 'execution_enqueue_once' || route === 'workflow_create'
          || route === 'workflow_update' || route === 'job_propose') {
          return withTelemetry({
            kind: 'clarify',
            route,
            message: '요청에 필요한 도구나 자연어 답변 여부를 확실히 판단하지 못했습니다. 원하는 결과와 대상을 조금 더 구체적으로 알려 주세요.',
            confidence,
          });
        }
        return withTelemetry(fallback('uncertain', `tool_selection_${toolSelection.reason}`));
      }
      requestPlan = {
        version: 2,
        request: {
          message: input.requestAnchor!.text,
          anchor: input.requestAnchor!,
          features: requestFeatures,
          context: {
            recentTurns: (input.conversationHistory ?? []).slice(-6).map(({ role, content }) => ({
              role,
              content: boundDecisionString(content, 800),
            })),
          },
        },
        response: { llmRequired: toolSelection.needsNaturalLanguageAnswer },
        operationDecisions: toolSelection.operationDecisions,
      };
    }
    const normalized = normalizeToolSelection({
      route, confidence, routerInput: input, requestFeatures, explicitAction, toolSelection, requestPlan, telemetry: tracker,
    });
    if ('kind' in normalized) return withTelemetry(normalized);
    const { selectedToolIds, hasSelectedWriteTools } = normalized;
    let selectedRoute = normalized.route;
    const selectedReadHints = operationHints.filter((hint) => selectedToolIds.has(`read:${hint.key}`));
    const selectedActionHints = [
      ...actionSelection.hints.filter(({ key }) => selectedToolIds.has(`write:${key}`)),
      ...transformCapabilities
        .filter((capability) => selectedToolIds.has(`transform:${capability.id}`))
        .map((capability, index) => ({ key: `transform_${index}`, capability })),
    ];
    if (selectedRoute === 'capability_read' && selectedToolIds.size === 0
      && toolSelection?.kind === 'selected' && toolSelection.needsNaturalLanguageAnswer) {
      selectedRoute = 'answer';
      tracker.update({ selectedRoute });
    }
    if (selectedRoute === 'answer') {
      if (selectedToolIds.size === 0) {
        return withTelemetry({ kind: 'reply', route: 'answer', confidence });
      }
      selectedRoute = !hasSelectedWriteTools && selectedReadHints.length >= 1
        ? 'capability_read'
        : (selectedToolIds.size === 1 && selectedReadHints.length === 1 ? 'capability_read' : 'execution_enqueue_once');
      tracker.update({ selectedRoute });
    }
    if (selectedRoute === 'capability_read' && selectedReadHints.length === 0) {
      return withTelemetry(fallback('missing_context'));
    }
    const intentGate = mutationIntentGate(selectedRoute, input, evaluation.answers, routeAnswer, route, confidence);
    if (intentGate) return withTelemetry(intentGate);

    return await dispatchJevRoute({
      input,
      route: selectedRoute,
      confidence,
      answers: evaluation.answers,
      explicitAction,
      requestFeatures,
      toolSelection,
      get requestPlan() { return requestPlan; },
      connectedConnectors,
      selectedReadHints,
      selectedActionHints,
      workflowTriggerHints,
      withTelemetry,
      evaluateFollowup,
      workflowPlanResult: (plan, planRoute) => {
        const planTelemetry = tracker.withPlan(plan);
        if (plan.kind === 'clarify' && plan.requestFailure) {
          return { kind: 'request_rejected', failure: plan.requestFailure, telemetry: planTelemetry };
        }
        const result: JevChatRouterResult = plan.kind === 'clarify'
          ? { kind: 'clarify', route: planRoute, message: plan.message, confidence }
          : {
              kind: 'command', route: planRoute, command: plan.command, confidence,
              ...(plan.commandPlan ? { commandPlan: plan.commandPlan } : {}),
            };
        return {
          ...result,
          ...(requestPlan ? { requestPlan } : {}),
          telemetry: planTelemetry,
          ...(plan.presentation ? { presentation: plan.presentation } : {}),
        };
      },
    });
  } catch (error) {
    if (input.abortSignal?.aborted) throw error;
    if (error instanceof AuthoritativeRequestError) return { kind: 'request_rejected', failure: error.failure };
    if (telemetry) return telemetry.serviceFailure(error);
    const failedProviderRequestCount = decisionProviderRequestCountFromError(error);
    return failedProviderRequestCount === undefined
      ? fallback('service_error')
      : { kind: 'fallback', reason: 'service_error', evaluationCalls: 0, providerRequestCount: failedProviderRequestCount };
  }
}

/** Workflow lifecycle routes need the current workflow and Jev's explicit intent answer. */
function mutationIntentGate(
  selectedRoute: JevChatRouteName,
  input: JevChatRouterInput,
  answers: Record<string, DecisionAnswer>,
  routeAnswer: ChoiceDecisionAnswer,
  route: JevChatRouteName,
  confidence: number,
): JevChatRouterResult | undefined {
  if ((selectedRoute === 'workflow_update' || selectedRoute === 'workflow_delete') && !input.currentWorkflowId?.trim()) {
    return fallback('missing_context');
  }
  const clarify = (message: string): JevChatRouterResult => ({
    kind: 'clarify', route: selectedRoute as 'workflow_create', message, confidence,
  });
  if (selectedRoute === 'workflow_create' && !input.hasWorkspaceSession) {
    return clarify('업무를 저장할 대화를 찾지 못했습니다. 새 대화에서 다시 요청해 주세요.');
  }
  if (selectedRoute === 'workflow_run'
    && (choiceAnswer(answers.explicit_workflow_run)?.choice !== 'run_now' || !isDominantRouteChoice(routeAnswer, route))) {
    return fallback('uncertain');
  }
  if (selectedRoute === 'workflow_create' && choiceAnswer(answers.explicit_workflow_create)?.choice !== 'create_now') {
    return clarify('새 업무를 저장하라는 요청인지 확실하지 않아 저장하지 않았습니다. 저장할 업무를 명시해 주세요.');
  }
  if (selectedRoute === 'workflow_delete'
    && (choiceAnswer(answers.explicit_workflow_delete)?.choice !== 'delete_now' || !isDominantRouteChoice(routeAnswer, route))) {
    return clarify('현재 업무를 삭제하라는 요청인지 확실하지 않아 삭제하지 않았습니다. 지우려면 "이 업무 삭제해 줘"처럼 말씀해 주세요.');
  }
  if (selectedRoute === 'workflow_update' && choiceAnswer(answers.explicit_workflow_update)?.choice !== 'update_now') {
    return clarify('현재 업무를 실제로 변경하라는 요청인지 확실하지 않아 수정하지 않았습니다. 바꿀 단계와 내용을 알려 주세요.');
  }
  return undefined;
}

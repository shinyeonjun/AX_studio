import {
  decisionProviderRequestBytesFromError,
  decisionProviderRequestCountFromError,
  type DecisionInstruction,
  type ChoiceDecisionAnswer,
  type DecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
} from '../../../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { choiceAnswerConfidence } from '../../../decision/confidence.js';
import { AxWorkflowUpdateArgsSchema, type AxCommand } from '../schema.js';
import type { AgentScopedContextMap } from '../../scoped-context.js';
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import type { WorkspaceSourceRecord } from '../../../../persistence/workspace-source-service.js';
import { availableCapabilities } from '../../../../catalog/capability-graph.js';
import {
  JEV_READ_OPERATION_MAX_CHOICES,
  selectJevReadOperationHints,
  type JevReadOperationHint,
  type JevReadOperationSelection,
} from '../../../decision/read-operation-catalog.js';
import { selectJevWorkflowTriggerHints } from './jev-workflow-proposal.js';
import {
  compileJevOneShotAction,
  jevActionQuestionGroups,
  selectJevActionHints,
  type JevActionHint,
  type JevActionInputValue,
  type JevActionQuestionGroup,
} from './jev-action-catalog.js';
import { planJevWorkflow, type JevWorkflowOutputHint } from './jev-workflow-plan.js';
import {
  compileJevWorkflowUpdate,
  workflowStepRemovalQuestions,
  type JevWorkflowStepCandidate,
  type JevWorkflowStepRemovalQuestionGroup,
  type JevWorkflowStepHint,
} from './jev-workflow-update.js';
import {
  explicitHttpPath,
  hasExplicitHttpEndpointCue,
  jevHttpEndpointChoices,
  selectHttpEndpointForRead,
  type JevHttpEndpointHint,
} from './jev-http-endpoint.js';
import { contextProposalCommand } from './context/proposal.js';
import { reportCommand, reportSourceQuestions, reportSources } from './jev-report-selection.js';
import {
  buildJevDecisionRequest,
  jevReadOperationQuestion,
  jevActionQuestion,
  type JevReadOperationQuestionGroup,
  type JevReadRecoveryContext,
} from './jev-decision-request.js';
import { mapJevQuotedActionInput } from './jev-action-input.js';
import { resolveJevReadOperationParameters } from './jev-read-parameters.js';
import { JEV_CHAT_ROUTE_CRITERIA, type JevChatRouteName } from './jev-route-criteria.js';
import { deriveJevRequestFeatures, type JevRequestFeatures } from './request-features.js';
import {
  JEV_TABLE_TRANSFORM_CRITERIA,
  type JevTableProjectionRequest,
  type JevTableTransformRequest,
  type JevTableTransformMode,
} from './jev-table-transform.js';

const ROUTE_QUERY_MAX_CHARS = 500;

export interface JevChatRouterInput {
  decisionEngine: DecisionEngine;
  userMessage: string;
  currentWorkflowId?: string;
  currentWorkflowVersion?: number;
  currentWorkflowSteps?: readonly JevWorkflowStepHint[];
  currentWorkflowOutputs?: readonly JevWorkflowOutputHint[];
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  hasWorkspaceSession?: boolean;
  connectedConnectors?: readonly string[];
  /** Host-validated values from a pending command; never sent to Jev. */
  actionInputValues?: readonly JevActionInputValue[];
  /** Safe endpoint hints only; base URLs and credentials never enter Jev state. */
  httpEndpoints?: readonly JevHttpEndpointHint[];
  /** Safe local mappings from Jev choices to host-owned read commands. */
  readOperationHints?: readonly JevReadOperationHint[];
  readOperationCatalogSize?: number;
  readOperationCatalogMayBeBounded?: boolean;
  /** When set, the host index has already prepared the candidate list for Jev. */
  readOperationSelectionMode?: JevReadOperationSelection['mode'] | 'prepared_candidates';
  readOperationLexicalMatchedOperationCount?: number;
  readOperationLexicalTopScore?: number;
  /** Host-held visible table from the immediately preceding assistant reply. */
  previousReadResult?: TableArtifact;
  /** Restricts the decision to an alternative read or stopping after a read-only failure. */
  readRecoveryContext?: JevReadRecoveryContext;
  workspaceSources?: readonly WorkspaceSourceRecord[];
  resolveWorkspaceSources?: () => readonly WorkspaceSourceRecord[];
  abortSignal?: AbortSignal;
}

interface JevChatRouterTelemetry {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  selectedRoute?: JevChatRouteName;
  routeConfidence?: number;
  actionScopeChoice?: string;
  actionScopeConfidence?: number;
  actionCandidateSelected?: boolean;
  actionCandidateConfidence?: number;
  questionIds: readonly string[];
  routeCandidateCount: number;
  operationCandidateCount: number;
  operationCatalogSize: number;
  operationCatalogMayBeBounded: boolean;
  actionCandidateCount: number;
  actionCatalogSize: number;
  actionCatalogMayBeBounded: boolean;
  operationSelectionMode?: JevReadOperationSelection['mode'] | 'prepared_candidates';
  operationLexicalMatchedOperationCount?: number;
  operationLexicalTopScore?: number;
  estimatedRequestBytes: number;
  evaluationCalls?: number;
  providerRequestCount?: number;
  planningCalls?: number;
  planningProviderRequestCount?: number;
  planningDurationMs?: number;
  planningStepCount?: number;
  planningCandidateCount?: number;
  planningCandidateCatalogMayBeBounded?: boolean;
  planningEstimatedRequestBytes?: number;
  planningInputTokens?: number;
  planningOutputTokens?: number;
  planningModels?: readonly string[];
}

type JevChatRouterFallbackReason =
  | 'uncertain'
  | 'unsupported'
  | 'missing_context'
  | 'http_endpoint_required'
  | 'http_path_required'
  | 'service_error';

interface MissingReadParameters {
  capabilityId: string;
  requiredParameterPaths: readonly string[];
}

type JevChatRouterResultValue =
  | { kind: 'command'; command: AxCommand; route: JevChatRouteName; confidence: number; tableTransform?: JevTableTransformRequest; tableProjection?: JevTableProjectionRequest; readResultStyle?: 'summary' }
  | { kind: 'previous_result'; route: 'previous_result'; confidence: number }
  | { kind: 'reply'; route: 'answer'; confidence: number }
  | { kind: 'clarify'; route: 'workflow_create' | 'workflow_update' | 'workflow_delete' | 'job_propose' | 'execution_enqueue_once' | 'context_remember' | 'report_generate'; message: string; confidence: number }
  | { kind: 'parameterized'; route: 'capability_read'; plan: MissingReadParameters; confidence: number }
  | {
      kind: 'fallback';
      reason: JevChatRouterFallbackReason;
      evaluationCalls?: number;
      providerRequestCount?: number;
    };

export type JevChatRouterResult = JevChatRouterResultValue & {
  telemetry?: JevChatRouterTelemetry;
};

function fallback(reason: JevChatRouterFallbackReason): JevChatRouterResult {
  return { kind: 'fallback', reason };
}

function choiceAnswer(answer: DecisionAnswer | undefined): ChoiceDecisionAnswer | undefined {
  return answer?.type === 'choice' ? answer : undefined;
}

function resultLimit(
  answers: Record<string, DecisionAnswer>,
  requestFeatures: JevRequestFeatures,
): number {
  const choice = choiceAnswer(answers.result_limit)?.choice;
  const match = /^limit_(\d+)$/u.exec(choice ?? '');
  const value = match ? requestFeatures.result_limit_candidates?.[Number(match[1])] : undefined;
  return value && Number.isSafeInteger(value) && value > 0 ? value : 10;
}

function tableTransformRequest(answer: DecisionAnswer | undefined): JevTableTransformRequest | undefined {
  const selected = choiceAnswer(answer);
  if (!selected) return 'uncertain';
  return Object.hasOwn(JEV_TABLE_TRANSFORM_CRITERIA, selected.choice)
    ? selected.choice as JevTableTransformMode | 'none'
    : 'uncertain';
}

function tableProjectionRequest(answer: DecisionAnswer | undefined): JevTableProjectionRequest | undefined {
  const selected = choiceAnswer(answer);
  if (!selected) return undefined;
  return selected.choice === 'requested_columns' ? selected.choice : undefined;
}

function readResultStyleRequest(answer: DecisionAnswer | undefined): 'summary' | undefined {
  const selected = choiceAnswer(answer);
  return selected?.choice === 'summary' ? 'summary' : undefined;
}

function httpReadCommand(
  input: JevChatRouterInput,
  answers: Record<string, DecisionAnswer>,
): AxCommand | JevChatRouterResult {
  const explicitMethod = deriveJevRequestFeatures(input.userMessage).explicit_http_method;
  if (explicitMethod && explicitMethod !== 'GET' && explicitMethod !== 'HEAD') {
    return fallback('unsupported');
  }
  const path = explicitHttpPath(input.userMessage);
  const endpoints = (input.httpEndpoints ?? []).filter((endpoint) => endpoint.usable !== false);
  if (endpoints.length === 0) return fallback('missing_context');

  const selectedByUser = selectHttpEndpointForRead(input.userMessage, endpoints);
  if (!selectedByUser && hasExplicitHttpEndpointCue(input.userMessage)) {
    return fallback('http_endpoint_required');
  }
  const endpointAnswer = choiceAnswer(answers.http_endpoint);
  const selectedChoice = endpointAnswer
    ? jevHttpEndpointChoices(endpoints).find(({ key }) => key === endpointAnswer.choice)
    : undefined;
  const selectedByJev = selectedChoice?.endpoint;
  const selected = selectedByUser ?? selectedByJev;
  if (!selected) return fallback('http_endpoint_required');
  if (!path) return fallback('http_path_required');

  return {
    name: 'capability.invoke',
    args: {
      id: 'http.request',
      params: {
        method: explicitMethod ?? 'GET',
        path,
        connectionId: selected.id,
      },
    },
  };
}

function capabilityReadCommandForHint(
  hint: JevReadOperationHint,
  routeConfidence: number,
): AxCommand | JevChatRouterResult {
  const missingParameterPaths = hint.missingParameterPaths ?? [];
  if (missingParameterPaths.length > 0) {
    const allowedParameterPaths = (hint.parameterHints ?? []).map((parameter) => parameter.path);
    if (allowedParameterPaths.length === 0) return fallback('missing_context');
    return {
      kind: 'parameterized',
      route: 'capability_read',
      confidence: routeConfidence,
      plan: {
        capabilityId: hint.capabilityId,
        requiredParameterPaths: missingParameterPaths,
      },
    };
  }
  const params = { ...hint.params };
  if (hint.connector === 'http' && params.query && typeof params.query === 'object' && !Array.isArray(params.query)) {
    const query = params.query as Record<string, unknown>;
    const rawPath = typeof params.path === 'string' ? params.path : '';
    const [pathAndQuery, fragment] = rawPath.split('#', 2);
    const queryStart = pathAndQuery!.indexOf('?');
    const path = queryStart < 0 ? pathAndQuery! : pathAndQuery!.slice(0, queryStart);
    const search = new URLSearchParams(queryStart < 0 ? '' : pathAndQuery!.slice(queryStart + 1));
    for (const [name, value] of Object.entries(query)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        search.set(name, String(value));
      }
    }
    params.path = `${path}${search.size > 0 ? `?${search.toString()}` : ''}${fragment === undefined ? '' : `#${fragment}`}`;
    delete params.query;
  }
  return {
    name: 'capability.invoke',
    args: {
      id: hint.capabilityId,
      params,
    },
  };
}

function capabilityReadCommand(
  hints: readonly JevReadOperationHint[],
  answers: Record<string, DecisionAnswer>,
  routeConfidence: number,
): AxCommand | JevChatRouterResult {
  if (hints.length === 0) return fallback('missing_context');
  const answer = choiceAnswer(answers.operation);
  if (!answer) return fallback('uncertain');
  if (answer.choice === 'none') return fallback('missing_context');
  const hint = hints.find((candidate) => candidate.key === answer.choice);
  if (!hint) {
    return fallback('uncertain');
  }
  return capabilityReadCommandForHint(hint, routeConfidence);
}

function selectedActionFinalists(
  groups: readonly JevActionQuestionGroup[],
  answers: Record<string, DecisionAnswer>,
): Array<{ hint: JevActionHint; answer: ChoiceDecisionAnswer }> | undefined {
  const finalists: Array<{ hint: JevActionHint; answer: ChoiceDecisionAnswer }> = [];
  for (const group of groups) {
    const answer = choiceAnswer(answers[group.questionId]);
    if (!answer) return undefined;
    if (answer.choice === 'none') continue;
    // Each choice set already includes `none`; confidence is not a second action policy here.
    const hint = group.hints.find((candidate) => candidate.key === answer.choice);
    if (!hint) return undefined;
    finalists.push({ hint, answer });
  }
  return finalists;
}

function selectedWorkflowStepFinalists(
  groups: readonly JevWorkflowStepRemovalQuestionGroup[],
  answers: Record<string, DecisionAnswer>,
): Array<{ candidate: JevWorkflowStepCandidate; answer: ChoiceDecisionAnswer }> | undefined {
  const finalists: Array<{ candidate: JevWorkflowStepCandidate; answer: ChoiceDecisionAnswer }> = [];
  for (const group of groups) {
    const answer = choiceAnswer(answers[group.questionId]);
    if (!answer) return undefined;
    if (answer.choice === 'none') continue;
    const candidate = group.candidates.find(({ index }) => `step_${index}` === answer.choice);
    if (!candidate) return undefined;
    finalists.push({ candidate, answer });
  }
  return finalists;
}

function commandForRoute(
  route: JevChatRouteName,
  input: JevChatRouterInput,
  answers: Record<string, DecisionAnswer>,
  requestFeatures: JevRequestFeatures,
): AxCommand | JevChatRouterResult {
  const query = boundDecisionString(input.userMessage, ROUTE_QUERY_MAX_CHARS);
  const workflowId = input.currentWorkflowId?.trim();

  switch (route) {
    case 'resource_list':
      return { name: 'resource.list', args: {} };
    case 'connection_list':
      return { name: 'http.list', args: {} };
    case 'http_read':
      return httpReadCommand(input, answers);
    case 'capability_read':
      return fallback('unsupported');
    case 'source_list':
      return { name: 'source.list', args: {} };
    case 'session_source_list':
      return input.hasWorkspaceSession
        ? { name: 'session.source.list', args: {} }
        : fallback('missing_context');
    case 'source_search':
      return { name: 'source.search', args: { query, limit: resultLimit(answers, requestFeatures) } };
    case 'discovery_search':
      return { name: 'discovery.search', args: { query, limit: resultLimit(answers, requestFeatures) } };
    case 'workflow_list':
      return { name: 'workflow.list', args: {} };
    case 'workflow_inspect':
      return workflowId
        ? { name: 'workflow.inspect', args: { workflowId } }
        : fallback('missing_context');
    case 'workflow_validate':
      return workflowId
        ? { name: 'workflow.validate', args: { workflowId } }
        : fallback('missing_context');
    case 'workflow_run':
      return workflowId
        ? { name: 'workflow.run', args: { workflowId } }
        : fallback('missing_context');
    case 'report_generate':
      return fallback('unsupported');
    case 'answer':
      return fallback('unsupported');
    default:
      return fallback('unsupported');
  }
}

/**
 * Uses Jev only to select a closed-set read/action route. The caller owns the
 * request deadline and cancellation across the initial decision and follow-ups.
 * The returned command is still validated and executed by AxCommandService;
 * Jev never supplies a command name, connector method, SQL, URL, or workflow payload.
 */
export async function routeChatWithJev(input: JevChatRouterInput): Promise<JevChatRouterResult> {
  input.abortSignal?.throwIfAborted();
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
  const operationSelectionMode = input.readOperationSelectionMode;
  const deferReadOperationChoices = operationSelectionMode === 'no_lexical_match'
    && operationHints.length > JEV_READ_OPERATION_MAX_CHOICES;
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
  const routeCatalog: Record<string, DecisionInstruction> = readRecovery
    ? { answer: JEV_CHAT_ROUTE_CRITERIA.answer, capability_read: JEV_CHAT_ROUTE_CRITERIA.capability_read }
    : JEV_CHAT_ROUTE_CRITERIA;
  if (!input.previousReadResult || readRecovery) delete routeCatalog.previous_result;
  let telemetry: JevChatRouterTelemetry | undefined;
  let evaluationCalls = 0;
  try {
    const {
      state,
      questions,
      routeCriteria,
      operationCriteria,
      operationGroups,
      deferredReadQuestions,
    } = buildJevDecisionRequest({
      userMessage: input.userMessage,
      requestFeatures,
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
      deferReadOperationChoices,
      actionSelection,
      readRecoveryContext: input.readRecoveryContext,
      previousReadResult: input.previousReadResult,
    });
    let actionGroups: JevActionQuestionGroup[] = [];
    evaluationCalls += 1;
    const evaluation = await input.decisionEngine.evaluate({
      state,
      questions,
      signal: input.abortSignal,
    });
    input.abortSignal?.throwIfAborted();
    telemetry = evaluation.model || evaluation.usage || evaluation.providerRequestCount !== undefined
      || evaluation.requestBytes !== undefined
      ? {
          ...(evaluation.model ? { model: evaluation.model } : {}),
          ...(evaluation.usage?.inputTokens === undefined ? {} : { inputTokens: evaluation.usage.inputTokens }),
          ...(evaluation.usage?.outputTokens === undefined ? {} : { outputTokens: evaluation.usage.outputTokens }),
          questionIds: Object.keys(questions),
          routeCandidateCount: Object.keys(routeCriteria).length,
          operationCandidateCount: deferReadOperationChoices ? 0 : Object.keys(operationCriteria).length,
          operationCatalogSize,
          operationCatalogMayBeBounded,
          actionCandidateCount: 0,
          actionCatalogSize: actionSelection.catalogSize,
          actionCatalogMayBeBounded: actionSelection.catalogMayBeBounded,
          ...(operationSelectionMode === undefined ? {} : { operationSelectionMode }),
          ...(input.readOperationLexicalMatchedOperationCount === undefined ? {} : {
            operationLexicalMatchedOperationCount: input.readOperationLexicalMatchedOperationCount,
          }),
          ...(input.readOperationLexicalTopScore === undefined ? {} : {
            operationLexicalTopScore: input.readOperationLexicalTopScore,
          }),
          estimatedRequestBytes: evaluation.requestBytes
            ?? new TextEncoder().encode(JSON.stringify({ state, questions })).byteLength,
          evaluationCalls,
          providerRequestCount: evaluation.providerRequestCount ?? 1,
        }
      : undefined;
    const withTelemetry = (result: JevChatRouterResult): JevChatRouterResult =>
      telemetry ? { ...result, telemetry } : result;
    const requestBytes = (requestState: unknown, requestQuestions: Record<string, DecisionQuestion>) =>
      new TextEncoder().encode(JSON.stringify({ state: requestState, questions: requestQuestions })).byteLength;
    const recordFollowupTelemetry = (
      followup: Awaited<ReturnType<DecisionEngine['evaluate']>>,
      followupState: unknown,
      followupQuestions: Record<string, DecisionQuestion>,
    ) => {
      const previous = telemetry ?? {
        questionIds: Object.keys(questions),
        routeCandidateCount: Object.keys(routeCriteria).length,
        operationCandidateCount: Object.keys(operationCriteria).length,
        operationCatalogSize,
        operationCatalogMayBeBounded,
        actionCandidateCount: 0,
        actionCatalogSize: actionSelection.catalogSize,
        actionCatalogMayBeBounded: actionSelection.catalogMayBeBounded,
        ...(operationSelectionMode === undefined ? {} : { operationSelectionMode }),
        providerRequestCount: 1,
        estimatedRequestBytes: evaluation.requestBytes ?? requestBytes(state, questions),
        evaluationCalls: 1,
      };
      telemetry = {
        ...previous,
        ...(followup.model ? { model: followup.model } : {}),
        ...(Object.keys(followupQuestions).some((questionId) =>
          questionId === 'action' || questionId.startsWith('action_group_') || questionId.startsWith('action_tournament_'),
        )
          ? { actionCandidateCount: actionSelection.hints.length }
          : {}),
        ...(Object.keys(followupQuestions).some((questionId) =>
          questionId === 'operation' || questionId.startsWith('operation_group_') || questionId.startsWith('operation_tournament_'),
        )
          ? { operationCandidateCount: Object.keys(operationCriteria).length }
          : {}),
        ...((previous.inputTokens !== undefined || followup.usage?.inputTokens !== undefined)
          ? { inputTokens: (previous.inputTokens ?? 0) + (followup.usage?.inputTokens ?? 0) }
          : {}),
        ...((previous.outputTokens !== undefined || followup.usage?.outputTokens !== undefined)
          ? { outputTokens: (previous.outputTokens ?? 0) + (followup.usage?.outputTokens ?? 0) }
          : {}),
        questionIds: [...previous.questionIds, ...Object.keys(followupQuestions)],
        estimatedRequestBytes: previous.estimatedRequestBytes
          + (followup.requestBytes ?? requestBytes(followupState, followupQuestions)),
        evaluationCalls,
        providerRequestCount: (previous.providerRequestCount ?? previous.evaluationCalls ?? 1)
          + (followup.providerRequestCount ?? 1),
      };
    };
    const resolveReadParameterChoices = async (
      hint: JevReadOperationHint,
    ): Promise<JevReadOperationHint> => {
      return resolveJevReadOperationParameters(hint, input.userMessage, async (parameterState, parameterQuestions) => {
        evaluationCalls += 1;
        const followup = await input.decisionEngine.evaluate({
          state: parameterState,
          questions: parameterQuestions,
          signal: input.abortSignal,
        });
        input.abortSignal?.throwIfAborted();
        recordFollowupTelemetry(followup, parameterState, parameterQuestions);
        return followup;
      });
    };

    const routeAnswer = choiceAnswer(evaluation.answers.route);
    if (!routeAnswer || !Object.prototype.hasOwnProperty.call(routeCriteria, routeAnswer.choice)) {
      return withTelemetry(fallback('unsupported'));
    }
    const route = routeAnswer.choice as JevChatRouteName;
    const confidence = choiceAnswerConfidence(routeAnswer, route);
    if (telemetry) telemetry = { ...telemetry, selectedRoute: route, routeConfidence: confidence };
    const explicitRun = choiceAnswer(evaluation.answers.explicit_workflow_run);
    const explicitWorkflowCreate = choiceAnswer(evaluation.answers.explicit_workflow_create);
    const explicitWorkflowDelete = choiceAnswer(evaluation.answers.explicit_workflow_delete);
    const explicitWorkflowUpdate = choiceAnswer(evaluation.answers.explicit_workflow_update);
    const selectedRoute = route;
    const selectedConfidence = confidence;
    let executionAnswers = evaluation.answers;
    // Ask about intent and scope with route selection; expose write candidates only
    // after Jev confirms a single immediate action.
    if (selectedRoute === 'execution_enqueue_once') {
      // Treat Jev's categorical answer as intent; its score is not a second intent policy.
      const explicitExecution = choiceAnswer(executionAnswers.explicit_execution_now);
      const actionScope = choiceAnswer(executionAnswers.action_scope);
      // Jev's intent and scope select this follow-up; the host allowlist and runtime policy constrain execution.
      if (
        actionSelection.hints.length > 0
        && explicitExecution?.choice === 'execute_now'
        && actionScope?.choice === 'single_action'
      ) {
        actionGroups = jevActionQuestionGroups(actionSelection.hints);
        const followupQuestions = Object.fromEntries(
          actionGroups.map((group) => [group.questionId, jevActionQuestion(group)]),
        );
        const followupState = { request: state.request, policy: state.policy };
        evaluationCalls += 1;
        const followup = await input.decisionEngine.evaluate({
          state: followupState,
          questions: followupQuestions,
          signal: input.abortSignal,
        });
        input.abortSignal?.throwIfAborted();
        executionAnswers = { ...executionAnswers, ...followup.answers };
        recordFollowupTelemetry(followup, followupState, followupQuestions);
      }
    }
    if (telemetry && selectedRoute === 'execution_enqueue_once') {
      const actionScope = choiceAnswer(executionAnswers.action_scope);
      const selectedActionConfidences = actionGroups
        .map((group) => choiceAnswer(executionAnswers[group.questionId]))
        .filter((answer): answer is ChoiceDecisionAnswer => Boolean(answer && answer.choice !== 'none'))
        .map((answer) => choiceAnswerConfidence(answer, answer.choice));
      const actionCandidateConfidence = selectedActionConfidences.reduce(
        (highest, confidence) => Math.max(highest, confidence),
        0,
      );
      telemetry = {
        ...telemetry,
        ...(actionScope ? {
          actionScopeChoice: actionScope.choice,
          actionScopeConfidence: choiceAnswerConfidence(actionScope, actionScope.choice),
        } : {}),
        actionCandidateSelected: selectedActionConfidences.length > 0,
        ...(selectedActionConfidences.length > 0
          ? { actionCandidateConfidence }
          : {}),
      };
    }

    if (selectedRoute === 'workflow_update' && !input.currentWorkflowId?.trim()) {
      return withTelemetry(fallback('missing_context'));
    }
    if (selectedRoute === 'workflow_delete' && !input.currentWorkflowId?.trim()) {
      return withTelemetry(fallback('missing_context'));
    }
    if (selectedRoute === 'workflow_create' && !input.hasWorkspaceSession) {
      return withTelemetry({
        kind: 'clarify',
        route: selectedRoute,
        message: 'workflow를 저장할 현재 대화 세션이 없습니다. 새 대화에서 다시 요청해 주세요.',
        confidence: selectedConfidence,
      });
    }

    if (selectedRoute === 'workflow_run' && explicitRun?.choice !== 'run_now') {
      return withTelemetry(fallback('uncertain'));
    } else if (selectedRoute === 'workflow_create' && explicitWorkflowCreate?.choice !== 'create_now') {
      return withTelemetry({
        kind: 'clarify',
        route: selectedRoute,
        message: '새 workflow를 저장하라는 요청인지 확실하지 않아 저장하지 않았습니다. 저장할 workflow를 명시해 주세요.',
        confidence: selectedConfidence,
      });
    } else if (selectedRoute === 'workflow_delete' && explicitWorkflowDelete?.choice !== 'delete_now') {
      return withTelemetry({
        kind: 'clarify',
        route: selectedRoute,
        message: '현재 workflow를 삭제하라는 요청인지 확실하지 않아 삭제하지 않았습니다.',
        confidence: selectedConfidence,
      });
    } else if (selectedRoute === 'workflow_update' && explicitWorkflowUpdate?.choice !== 'update_now') {
      return withTelemetry({
        kind: 'clarify',
        route: selectedRoute,
        message: '현재 workflow를 실제로 변경하라는 요청인지 확실하지 않아 수정하지 않았습니다.',
        confidence: selectedConfidence,
      });
    }

    if (selectedRoute === 'report_generate') {
      if (!input.hasWorkspaceSession) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '보고서를 만들려면 현재 대화에 빈 PDF 템플릿과 완성된 보고서 예시를 각각 첨부해 주세요.',
          confidence: selectedConfidence,
        });
      }
      const reportSelection = reportSources(input.resolveWorkspaceSources?.() ?? input.workspaceSources);
      if (reportSelection.catalogSize < 2) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '보고서를 만들려면 현재 대화에 빈 PDF 템플릿과 완성된 보고서 예시를 각각 첨부해 주세요.',
          confidence: selectedConfidence,
        });
      }
      const sourceState = {
        request: boundDecisionString(input.userMessage),
        context: { ready_pdf_candidate_count: reportSelection.catalogSize },
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      };
      const sourceQuestions = reportSourceQuestions(reportSelection.candidates);
      evaluationCalls += 1;
      const sourceEvaluation = await input.decisionEngine.evaluate({
        state: sourceState,
        questions: sourceQuestions,
        signal: input.abortSignal,
      });
      input.abortSignal?.throwIfAborted();
      recordFollowupTelemetry(sourceEvaluation, sourceState, sourceQuestions);
      const command = reportCommand({
        hasWorkspaceSession: input.hasWorkspaceSession,
        userMessage: input.userMessage,
        answers: sourceEvaluation.answers,
        candidates: reportSelection.candidates,
      });
      if ('kind' in command) return withTelemetry(command);
      return withTelemetry({ kind: 'command', command, route: selectedRoute, confidence: selectedConfidence });
    }

    const workflowPlanResult = (
      plan: Awaited<ReturnType<typeof planJevWorkflow>>,
      route: 'workflow_create' | 'workflow_update' | 'execution_enqueue_once' | 'job_propose',
    ): JevChatRouterResult => {
      const baseTelemetry = telemetry ?? {
        questionIds: Object.keys(questions),
        routeCandidateCount: Object.keys(routeCriteria).length,
        operationCandidateCount: Object.keys(operationCriteria).length,
        operationCatalogSize,
        operationCatalogMayBeBounded,
        actionCandidateCount: actionSelection.hints.length,
        actionCatalogSize: actionSelection.catalogSize,
        actionCatalogMayBeBounded: actionSelection.catalogMayBeBounded,
        estimatedRequestBytes: evaluation.requestBytes
          ?? new TextEncoder().encode(JSON.stringify({ state, questions })).byteLength,
        providerRequestCount: 1,
      };
      const planTelemetry: JevChatRouterTelemetry = {
        ...baseTelemetry,
        evaluationCalls: (telemetry?.evaluationCalls ?? 1) + plan.telemetry.calls,
        providerRequestCount: (telemetry?.providerRequestCount ?? telemetry?.evaluationCalls ?? 1)
          + plan.telemetry.providerRequestCount,
        planningCalls: plan.telemetry.calls,
        planningProviderRequestCount: plan.telemetry.providerRequestCount,
        planningDurationMs: plan.telemetry.durationMs,
        planningStepCount: plan.telemetry.plannedStepCount,
        planningCandidateCount: plan.telemetry.candidateCount,
        planningCandidateCatalogMayBeBounded: plan.telemetry.candidateCatalogMayBeBounded,
        planningEstimatedRequestBytes: plan.telemetry.estimatedRequestBytes,
        planningInputTokens: plan.telemetry.inputTokens,
        planningOutputTokens: plan.telemetry.outputTokens,
        planningModels: plan.telemetry.models,
      };
      const result: JevChatRouterResult = plan.kind === 'clarify'
        ? { kind: 'clarify', route, message: plan.message, confidence: selectedConfidence }
        : { kind: 'command', route, command: plan.command, confidence: selectedConfidence };
      return { ...result, telemetry: planTelemetry };
    };

    if (selectedRoute === 'answer') return withTelemetry({ kind: 'reply', route: selectedRoute, confidence: selectedConfidence });
    if (selectedRoute === 'previous_result') {
      return withTelemetry({ kind: 'previous_result', route: selectedRoute, confidence: selectedConfidence });
    }
    if (selectedRoute === 'workflow_create') {
      const triggerAnswer = choiceAnswer(evaluation.answers.workflow_trigger);
      // `none` means Jev is unsure; it is not equivalent to explicit manual execution.
      if (!triggerAnswer || triggerAnswer.choice !== 'manual') {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '수동 workflow 생성과 반복 시작 조건을 같은 요청으로 판단해 저장하지 않았습니다. 한 번 실행할 업무인지, 일정·이벤트로 반복할 업무인지 확인해 주세요.',
          confidence: selectedConfidence,
        });
      }
      const plan = await planJevWorkflow({
        decisionEngine: input.decisionEngine,
        request: input.userMessage,
        mode: 'manual_workflow',
        connectedConnectors: input.connectedConnectors ?? [],
        sessionMemo: input.sessionMemo,
        workflowPolicy: input.workflowPolicy,
        readOperationHints: operationHints,
        actionHints: actionSelection.hints,
        actionInputValues: input.actionInputValues,
        signal: input.abortSignal,
      });
      return workflowPlanResult(plan, selectedRoute);
    }
    if (selectedRoute === 'workflow_delete') {
      const workflowId = input.currentWorkflowId?.trim();
      if (!workflowId) return withTelemetry(fallback('missing_context'));
      const baseVersion = input.currentWorkflowVersion;
      if (!Number.isSafeInteger(baseVersion) || (baseVersion ?? 0) < 1) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '현재 workflow의 최신 버전을 확인하지 못해 삭제하지 않았습니다. 대화를 새로 고친 뒤 다시 요청해 주세요.',
          confidence: selectedConfidence,
        });
      }
      return withTelemetry({
        kind: 'command',
        route: selectedRoute,
        confidence: selectedConfidence,
        command: {
          name: 'workflow.delete',
          args: { workflowId, baseVersion: baseVersion as number },
        },
      });
    }
    if (selectedRoute === 'workflow_update') {
      let updateAnswers = evaluation.answers;
      const workflowSteps = input.currentWorkflowSteps ?? [];
      const removalIntent = choiceAnswer(evaluation.answers.explicit_workflow_step_removal);
      const additionIntent = choiceAnswer(evaluation.answers.explicit_workflow_step_addition);
      if (!additionIntent || !['add_now', 'do_not_add'].includes(additionIntent.choice)) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: 'workflow 단계 추가 여부를 확인하지 못해 아무것도 변경하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      if (workflowSteps.length > 0 && (!removalIntent || !['remove_now', 'do_not_remove'].includes(removalIntent.choice))) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: 'workflow 단계 제거 여부를 확인하지 못해 아무것도 변경하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      if (removalIntent?.choice === 'remove_now' && workflowSteps.length > 0) {
        const updateState = {
          request: boundDecisionString(input.userMessage),
          context: { current_workflow_step_count: workflowSteps.length },
          policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        };
        const evaluateStepCandidates = async (
          candidates: readonly JevWorkflowStepCandidate[],
          questionPrefix = 'workflow_step_to_remove',
        ) => {
          const groups = workflowStepRemovalQuestions(candidates, questionPrefix);
          const stepQuestions = Object.fromEntries(groups.map(({ questionId, question }) => [questionId, question]));
          evaluationCalls += 1;
          const stepEvaluation = await input.decisionEngine.evaluate({
            state: updateState,
            questions: stepQuestions,
            signal: input.abortSignal,
          });
          input.abortSignal?.throwIfAborted();
          recordFollowupTelemetry(stepEvaluation, updateState, stepQuestions);
          return selectedWorkflowStepFinalists(groups, stepEvaluation.answers);
        };
        let finalists = await evaluateStepCandidates(workflowSteps.map((step, index) => ({ step, index })));
        let round = 0;
        while (finalists && finalists.length > 1) {
          finalists = await evaluateStepCandidates(
            finalists.map(({ candidate }) => candidate),
            `workflow_step_tournament_${round}`,
          );
          round += 1;
        }
        if (finalists?.length !== 1) {
          return withTelemetry({
            kind: 'clarify',
            route: selectedRoute,
            message: '제거할 workflow 단계를 목록에서 하나로 확정하지 못해 아무것도 변경하지 않았습니다.',
            confidence: selectedConfidence,
          });
        }
        updateAnswers = { ...evaluation.answers, workflow_step_to_remove: finalists[0]!.answer };
      }
      if (additionIntent.choice === 'add_now') {
        const workflowId = input.currentWorkflowId!.trim();
        const removedChoice = choiceAnswer(updateAnswers.workflow_step_to_remove)?.choice.match(/^step_(0|[1-9]\d*)$/u);
        const removedIndex = removedChoice ? Number(removedChoice[1]) : -1;
        const removedStepId = Number.isSafeInteger(removedIndex) ? workflowSteps[removedIndex]?.id : undefined;
        const plan = await planJevWorkflow({
          decisionEngine: input.decisionEngine,
          request: input.userMessage,
          mode: 'workflow_update',
          workflowId,
          workflowVersion: input.currentWorkflowVersion,
          existingStepIds: workflowSteps.map(({ id }) => id),
          removedStepIds: removedStepId ? [removedStepId] : [],
          workflowOutputs: input.currentWorkflowOutputs?.filter(({ from }) => from !== removedStepId),
          connectedConnectors: input.connectedConnectors ?? [],
          sessionMemo: input.sessionMemo,
          workflowPolicy: input.workflowPolicy,
          readOperationHints: operationHints,
          actionHints: actionSelection.hints,
          actionInputValues: input.actionInputValues,
          signal: input.abortSignal,
        });
        if (plan.kind === 'clarify') return workflowPlanResult(plan, selectedRoute);
        const parsedPlan = plan.command.name === 'workflow.update'
          ? AxWorkflowUpdateArgsSchema.safeParse(plan.command.args)
          : undefined;
        const upsertSteps = parsedPlan?.success
          ? parsedPlan.data.operations.flatMap((operation) => operation.op === 'upsert_step' ? [operation.step] : [])
          : [];
        if (!parsedPlan?.success || upsertSteps.length === 0) {
          return workflowPlanResult({
            kind: 'clarify',
            message: 'workflow 단계 변경안을 검증하지 못해 아무것도 변경하지 않았습니다.',
            telemetry: plan.telemetry,
          }, selectedRoute);
        }
        const resolution = compileJevWorkflowUpdate({
          userMessage: input.userMessage,
          workflowId,
          workflowVersion: input.currentWorkflowVersion,
          steps: workflowSteps,
          answers: updateAnswers,
          upsertSteps,
        });
        return workflowPlanResult(resolution.kind === 'command'
          ? { ...plan, command: resolution.command }
          : { kind: 'clarify', message: resolution.message, telemetry: plan.telemetry }, selectedRoute);
      }
      const resolution = compileJevWorkflowUpdate({
        userMessage: input.userMessage,
        workflowId: input.currentWorkflowId!.trim(),
        workflowVersion: input.currentWorkflowVersion,
        steps: input.currentWorkflowSteps,
        answers: updateAnswers,
      });
      if (resolution.kind === 'clarify') {
        return withTelemetry({
          kind: 'clarify', route: selectedRoute, message: resolution.message, confidence: selectedConfidence,
        });
      }
      return withTelemetry({
        kind: 'command',
        route: selectedRoute,
        confidence: selectedConfidence,
        command: resolution.command,
      });
    }
    if (selectedRoute === 'execution_enqueue_once') {
      if (actionSelection.hints.length === 0) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '요청에 맞는 연결된 쓰기 도구를 찾지 못했습니다. 사용할 서비스와 동작을 알려 주세요. 아무 작업도 실행하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      if (choiceAnswer(executionAnswers.explicit_execution_now)?.choice !== 'execute_now') {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '지금 실행하라는 요청인지 확실하지 않아 아무 작업도 등록하지 않았습니다. 실행을 원하면 지금 수행해 달라고 명확히 요청해 주세요.',
          confidence: selectedConfidence,
        });
      }
      const scope = choiceAnswer(executionAnswers.action_scope);
      if (scope?.choice === 'multi_step') {
        const plan = await planJevWorkflow({
          decisionEngine: input.decisionEngine,
          request: input.userMessage,
          connectedConnectors: input.connectedConnectors ?? [],
          sessionMemo: input.sessionMemo,
          workflowPolicy: input.workflowPolicy,
          readOperationHints: operationHints,
          actionHints: actionSelection.hints,
          actionInputValues: input.actionInputValues,
          signal: input.abortSignal,
        });
        return workflowPlanResult(plan, selectedRoute);
      }
      if (scope?.choice !== 'single_action') {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '요청을 한 번의 도구 동작으로 안전하게 좁히지 못했습니다. 수행할 동작과 대상을 더 구체적으로 알려 주세요. 아직 실행하거나 저장하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      let finalists = selectedActionFinalists(actionGroups, executionAnswers);
      if (!finalists || finalists.length === 0) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '연결된 도구 중 요청과 일치하는 쓰기 작업을 확실히 고르지 못했습니다. 사용할 서비스와 원하는 동작을 알려 주세요. 아무 작업도 실행하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      let round = 0;
      while (finalists.length > 1) {
        const groups = jevActionQuestionGroups(finalists.map(({ hint }) => hint), `action_tournament_${round}`);
        const followupQuestions = Object.fromEntries(
          groups.map((group) => [group.questionId, jevActionQuestion(group)]),
        );
        const followupState = { request: state.request, policy: state.policy };
        evaluationCalls += 1;
        const followup = await input.decisionEngine.evaluate({
          state: followupState,
          questions: followupQuestions,
          signal: input.abortSignal,
        });
        input.abortSignal?.throwIfAborted();
        recordFollowupTelemetry(followup, followupState, followupQuestions);
        finalists = selectedActionFinalists(groups, followup.answers) ?? [];
        if (finalists.length === 0) {
          return withTelemetry({
            kind: 'clarify',
            route: selectedRoute,
            message: '연결된 도구 중 요청과 일치하는 쓰기 작업을 확실히 고르지 못했습니다. 사용할 서비스와 원하는 동작을 알려 주세요. 아무 작업도 실행하지 않았습니다.',
            confidence: selectedConfidence,
          });
        }
        round += 1;
      }
      const winner = finalists[0]!;
      const capability = winner.hint.capability;
      const actionInput = await mapJevQuotedActionInput({
        capability,
        userMessage: input.userMessage,
        inputValues: input.actionInputValues,
        stepId: 'action_1',
        evaluate: async (state, questions) => {
          evaluationCalls += 1;
          const followup = await input.decisionEngine.evaluate({
            state,
            questions,
            signal: input.abortSignal,
          });
          input.abortSignal?.throwIfAborted();
          recordFollowupTelemetry(followup, state, questions);
          return followup;
        },
      });
      if (actionInput.kind === 'uncertain') {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '인용한 문구를 연결된 작업의 어떤 입력값으로 써야 할지 확실하지 않습니다. 제목·본문처럼 입력 항목을 지정해 주세요. 아무 작업도 등록하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      const command = compileJevOneShotAction(
        [winner.hint],
        winner.answer,
        input.userMessage,
        actionInput.kind === 'mapped'
          ? [...(input.actionInputValues ?? []), actionInput.inputValue]
          : input.actionInputValues,
      );
      if (!command) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '연결된 도구 중 요청과 일치하는 쓰기 작업을 확실히 고르지 못했습니다. 사용할 서비스와 원하는 동작을 알려 주세요. 아무 작업도 실행하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      return withTelemetry({ kind: 'command', command, route: selectedRoute, confidence: selectedConfidence });
    }
    if (selectedRoute === 'job_propose') {
      if (!input.hasWorkspaceSession) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '반복 업무 초안을 만들 현재 대화 세션이 없습니다. 새 대화에서 다시 요청해 주세요.',
          confidence: selectedConfidence,
        });
      }
      const triggerAnswer = choiceAnswer(evaluation.answers.workflow_trigger);
      const selectedTrigger = triggerAnswer?.choice === 'schedule'
        ? { key: 'schedule', trigger: { type: 'schedule' as const, schedule: '', timezone: '' } }
        : triggerAnswer
          ? workflowTriggerHints.find((hint) => hint.key === triggerAnswer.choice)
          : undefined;
      if (!triggerAnswer || !selectedTrigger) {
        return withTelemetry({
          kind: 'clarify',
          route: selectedRoute,
          message: '요청과 맞는 시작 조건을 확실히 고르지 못했습니다. 어떤 연결 이벤트가 업무를 시작해야 하는지 알려 주세요. 아무것도 저장하거나 활성화하지 않았습니다.',
          confidence: selectedConfidence,
        });
      }
      const plan = await planJevWorkflow({
        decisionEngine: input.decisionEngine,
        request: input.userMessage,
        mode: 'recurring_workflow',
        trigger: selectedTrigger.trigger,
        connectedConnectors: input.connectedConnectors ?? [],
        sessionMemo: input.sessionMemo,
        workflowPolicy: input.workflowPolicy,
        readOperationHints: operationHints,
        actionHints: actionSelection.hints,
        actionInputValues: input.actionInputValues,
        signal: input.abortSignal,
      });
      return workflowPlanResult(plan, selectedRoute);
    }
    if (selectedRoute === 'context_remember') {
      const command = contextProposalCommand(input);
      if ('kind' in command) return withTelemetry(command);
      return withTelemetry({ kind: 'command', command, route: selectedRoute, confidence: selectedConfidence });
    }
    let command: AxCommand | JevChatRouterResult;
    let selectedReadHint: JevReadOperationHint | undefined;
    let selectedReadAnswer: ChoiceDecisionAnswer | undefined;
    let readAnswers = evaluation.answers;
    if (selectedRoute === 'capability_read' && deferReadOperationChoices) {
      const readSelectionState = {
        ...state,
        context: { ...state.context, read_operation_candidates_deferred: false },
      };
      evaluationCalls += 1;
      const followup = await input.decisionEngine.evaluate({
        state: readSelectionState,
        questions: deferredReadQuestions,
        signal: input.abortSignal,
      });
      input.abortSignal?.throwIfAborted();
      readAnswers = { ...readAnswers, ...followup.answers };
      recordFollowupTelemetry(followup, readSelectionState, deferredReadQuestions);
    }
    if (selectedRoute === 'capability_read' && operationGroups.length > 0) {
      let finalists: Array<{ hint: JevReadOperationHint; answer: ChoiceDecisionAnswer }> = [];
      for (const group of operationGroups) {
        const answer = choiceAnswer(readAnswers[group.questionId]);
        if (!answer) return withTelemetry(fallback('uncertain'));
        if (answer.choice === 'none') continue;
        const hint = group.hints.find((candidate) => candidate.key === answer.choice);
        if (!hint) {
          return withTelemetry(fallback('uncertain'));
        }
        finalists.push({ hint, answer });
      }
      if (finalists.length === 0) return withTelemetry(fallback('missing_context'));

      let round = 0;
      while (finalists.length > 1) {
        input.abortSignal?.throwIfAborted();
        const groups: JevReadOperationQuestionGroup[] = [];
        const followupQuestions: Record<string, DecisionQuestion> = {};
        for (let offset = 0; offset < finalists.length; offset += JEV_READ_OPERATION_MAX_CHOICES) {
          const hints = finalists.slice(offset, offset + JEV_READ_OPERATION_MAX_CHOICES).map(({ hint }) => hint);
          const group = {
            questionId: `operation_tournament_${round}_${groups.length}`,
            hints,
          };
          groups.push(group);
          followupQuestions[group.questionId] = jevReadOperationQuestion(hints, readRecovery);
        }
        evaluationCalls += 1;
        const followup = await input.decisionEngine.evaluate({
          state,
          questions: followupQuestions,
          signal: input.abortSignal,
        });
        input.abortSignal?.throwIfAborted();
        recordFollowupTelemetry(followup, state, followupQuestions);

        const nextFinalists: typeof finalists = [];
        for (const group of groups) {
          const answer = choiceAnswer(followup.answers[group.questionId]);
          if (!answer) return withTelemetry(fallback('uncertain'));
          if (answer.choice === 'none') continue;
          const hint = group.hints.find((candidate) => candidate.key === answer.choice);
          if (!hint) {
            return withTelemetry(fallback('uncertain'));
          }
          nextFinalists.push({ hint, answer });
        }
        if (nextFinalists.length === 0) return withTelemetry(fallback('missing_context'));
        finalists = nextFinalists;
        round += 1;
      }

      const winner = finalists[0]!;
      selectedReadHint = winner.hint;
      selectedReadAnswer = winner.answer;
      command = capabilityReadCommandForHint(winner.hint, selectedConfidence);
    } else {
      if (selectedRoute === 'capability_read') {
        const answer = choiceAnswer(readAnswers.operation);
        selectedReadAnswer = answer;
        selectedReadHint = answer
          ? operationHints.find((candidate) => candidate.key === answer.choice)
          : undefined;
        command = capabilityReadCommand(operationHints, readAnswers, selectedConfidence);
      } else {
        command = commandForRoute(selectedRoute, input, readAnswers, requestFeatures);
      }
    }
    if (selectedReadHint && selectedReadAnswer) {
      selectedReadHint = await resolveReadParameterChoices(selectedReadHint);
      command = capabilityReadCommandForHint(selectedReadHint, selectedConfidence);
    }
    if ('kind' in command) return withTelemetry(command);
    const transformRequest = selectedRoute === 'capability_read' || selectedRoute === 'http_read'
      ? tableTransformRequest(readAnswers.table_transform)
      : undefined;
    const projectionRequest = selectedRoute === 'capability_read' || selectedRoute === 'http_read'
      ? tableProjectionRequest(readAnswers.table_projection)
      : undefined;
    const readResultStyle = selectedRoute === 'capability_read' || selectedRoute === 'http_read'
      ? readResultStyleRequest(readAnswers.read_result_style)
      : undefined;
    return withTelemetry({
      kind: 'command', command, route: selectedRoute, confidence: selectedConfidence,
      ...(transformRequest ? { tableTransform: transformRequest } : {}),
      ...(projectionRequest ? { tableProjection: projectionRequest } : {}),
      ...(readResultStyle ? { readResultStyle } : {}),
    });
  } catch (error) {
    if (input.abortSignal?.aborted) throw error;
    const failedProviderRequestCount = decisionProviderRequestCountFromError(error);
    const failedProviderRequestBytes = decisionProviderRequestBytesFromError(error);
    if (telemetry) {
      return {
        ...fallback('service_error'),
        telemetry: {
          ...telemetry,
          evaluationCalls,
          ...(failedProviderRequestCount === undefined ? {} : {
            providerRequestCount: (telemetry.providerRequestCount ?? 0) + failedProviderRequestCount,
          }),
          ...(failedProviderRequestBytes === undefined ? {} : {
            estimatedRequestBytes: telemetry.estimatedRequestBytes + failedProviderRequestBytes,
          }),
        },
      };
    }
    if (failedProviderRequestCount !== undefined) {
      return {
        kind: 'fallback',
        reason: 'service_error',
        evaluationCalls,
        providerRequestCount: failedProviderRequestCount,
      };
    }
    return fallback('service_error');
  }
}

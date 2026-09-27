import {
  decisionProviderRequestBytesFromError,
  decisionProviderRequestCountFromError,
  type DecisionInstruction,
  type DecisionEngine,
  type DecisionQuestion,
} from '../../../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { choiceAnswerConfidence } from '../../../decision/confidence.js';
import type { AxCommand } from '../schema.js';
import { availableCapabilities } from '../../../../catalog/capability-graph.js';
import {
  selectJevReadOperationHints,
  type JevReadOperationHint,
} from '../../../decision/read-operation-catalog.js';
import { selectJevWorkflowTriggerHints } from './jev-workflow-proposal.js';
import {
  selectJevActionHints,
} from './jev-action-catalog.js';
import { planJevSelectedTools, type JevWorkflowPlanResult } from './jev-workflow-plan.js';
import { contextProposalCommand } from './context/proposal.js';
import { reportCommand, reportSourceQuestions, reportSources } from './jev-report-selection.js';
import {
  buildJevDecisionRequest,
} from './jev-decision-request.js';
import { resolveJevReadOperationParameters } from './jev-read-parameters.js';
import { JEV_CHAT_ROUTE_CRITERIA, type JevChatRouteName } from './jev-route-criteria.js';
import { deriveJevRequestFeatures } from './request-features.js';
import {
  parseParallelToolSelection,
  type JevParallelToolCandidate,
  type JevParallelToolSelection,
} from './jev-parallel-tool-selection.js';
import type {
  JevChatRouterInput,
  JevChatRouterResult,
  JevChatRouterTelemetry,
} from './jev-router-contract.js';
export type { JevChatRouterInput, JevChatRouterResult } from './jev-router-contract.js';
import {
  capabilityReadCommandForHint,
  choiceAnswer,
  commandForRoute,
  fallback,
  tableProjectionRequest,
  tableTransformRequest,
} from './jev-router-command.js';
import { handleJevWorkflowRoute } from './jev-router-workflows.js';

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
  const deferReadOperationChoices = false;
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
  const parallelToolCandidates: JevParallelToolCandidate[] = [
    ...operationHints.map((hint) => ({
      id: `read:${hint.key}`,
      kind: 'read' as const,
      connector: hint.connector,
      label: hint.label,
      description: hint.description,
    })),
    ...actionSelection.hints.map(({ key, capability }) => ({
      id: `write:${key}`,
      kind: 'write' as const,
      connector: capability.connector,
      label: capability.label,
      description: capability.description,
    })),
  ];
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
      parallelToolCandidates,
      readRecoveryContext: input.readRecoveryContext,
      previousReadResult: input.previousReadResult,
    });
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
          actionCandidateCount: actionSelection.hints.length,
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
    const evaluateFollowup = async (
      followupState: unknown,
      followupQuestions: Record<string, DecisionQuestion>,
    ): Promise<Awaited<ReturnType<DecisionEngine['evaluate']>>> => {
      input.abortSignal?.throwIfAborted();
      evaluationCalls += 1;
      const followup = await input.decisionEngine.evaluate({
        state: followupState,
        questions: followupQuestions,
        signal: input.abortSignal,
      });
      input.abortSignal?.throwIfAborted();
      recordFollowupTelemetry(followup, followupState, followupQuestions);
      return followup;
    };
    const resolveReadParameterChoices = async (
      hint: JevReadOperationHint,
    ): Promise<JevReadOperationHint> => {
      return resolveJevReadOperationParameters(hint, input.userMessage, evaluateFollowup);
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
    let toolSelection: JevParallelToolSelection | undefined;
    const updateAddsSteps = choiceAnswer(evaluation.answers.explicit_workflow_step_addition)?.choice === 'add_now';
    const selectionRoute = selectedRoute === 'answer'
      || selectedRoute === 'capability_read'
      || selectedRoute === 'execution_enqueue_once'
      || selectedRoute === 'workflow_create'
      || selectedRoute === 'job_propose'
      || (selectedRoute === 'workflow_update' && updateAddsSteps);
    if (selectionRoute) {
      toolSelection = parseParallelToolSelection({
        candidates: parallelToolCandidates,
        answers: evaluation.answers,
        telemetry: {
          evaluationCalls: 1,
          providerRequestCount: evaluation.providerRequestCount ?? 1,
          estimatedRequestBytes: evaluation.requestBytes
            ?? new TextEncoder().encode(JSON.stringify({ state, questions })).byteLength,
          candidateCount: parallelToolCandidates.length,
        },
      });
      if (toolSelection.kind === 'clarify') {
        const message = toolSelection.reason === 'tool_count_mismatch'
          ? '선택한 실행 유형과 필요한 도구 수가 맞지 않습니다. 한 개 실행인지, 여러 도구 실행인지 요청을 분명히 해 주세요.'
          : '요청에 필요한 도구를 확실히 고르지 못했습니다. 사용할 서비스와 원하는 결과를 더 구체적으로 알려 주세요.';
        if (selectedRoute === 'answer' || selectedRoute === 'capability_read') {
          return withTelemetry(fallback('uncertain'));
        }
        return withTelemetry({ kind: 'clarify', route: selectedRoute, message, confidence: selectedConfidence });
      }
      if ((selectedRoute === 'answer') !== (toolSelection.kind === 'reply')) {
        return withTelemetry(fallback('uncertain'));
      }
      if (selectedRoute === 'capability_read' && toolSelection.kind === 'selected'
        && toolSelection.selectedToolIds.some((id) => !id.startsWith('read:'))) {
        return withTelemetry(fallback('uncertain'));
      }
      if (telemetry && toolSelection.kind === 'selected') {
        telemetry = {
          ...telemetry,
          actionScopeChoice: toolSelection.mode,
          actionCandidateSelected: toolSelection.selectedToolIds.some((id) => id.startsWith('write:')),
        };
      }
    }
    const selectedToolIds = toolSelection?.kind === 'selected'
      ? new Set(toolSelection.selectedToolIds)
      : new Set<string>();
    const selectedReadHints = operationHints.filter((hint) => selectedToolIds.has(`read:${hint.key}`));
    const selectedActionHints = actionSelection.hints.filter(({ key }) => selectedToolIds.has(`write:${key}`));

    if (
      (selectedRoute === 'workflow_update' || selectedRoute === 'workflow_delete')
      && !input.currentWorkflowId?.trim()
    ) {
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
      const sourceEvaluation = await evaluateFollowup(sourceState, sourceQuestions);
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
      plan: JevWorkflowPlanResult,
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
    const workflowRouteResult = await handleJevWorkflowRoute({
      input,
      route: selectedRoute,
      confidence: selectedConfidence,
      answers: evaluation.answers,
      selectedReadHints,
      selectedActionHints,
      workflowTriggerHints,
      withTelemetry,
      evaluateFollowup,
      workflowPlanResult,
    });
    if (workflowRouteResult) return workflowRouteResult;
    if (selectedRoute === 'execution_enqueue_once') {
      if (toolSelection?.kind !== 'selected') return withTelemetry(fallback('uncertain'));
      const plan = await planJevSelectedTools({
        decisionEngine: input.decisionEngine,
        request: input.userMessage,
        mode: 'one_shot',
        connectedConnectors,
        readOperationHints: selectedReadHints,
        actionHints: selectedActionHints,
        actionInputValues: input.actionInputValues,
        sessionMemo: input.sessionMemo,
        workflowPolicy: input.workflowPolicy,
        signal: input.abortSignal,
      });
      return workflowPlanResult(plan, selectedRoute);
    }
    if (selectedRoute === 'context_remember') {
      const command = contextProposalCommand(input);
      if ('kind' in command) return withTelemetry(command);
      return withTelemetry({ kind: 'command', command, route: selectedRoute, confidence: selectedConfidence });
    }
    const readAnswers = evaluation.answers;
    let command: AxCommand | JevChatRouterResult;
    if (selectedRoute === 'capability_read' && selectedReadHints.length > 1) {
      const plan = await planJevSelectedTools({
        decisionEngine: input.decisionEngine,
        request: input.userMessage,
        mode: 'one_shot',
        connectedConnectors,
        readOperationHints: selectedReadHints,
        actionHints: [],
        sessionMemo: input.sessionMemo,
        workflowPolicy: input.workflowPolicy,
        signal: input.abortSignal,
      });
      return workflowPlanResult(plan, 'execution_enqueue_once');
    }
    if (selectedRoute === 'capability_read') {
      const hint = selectedReadHints[0];
      if (!hint) return withTelemetry(fallback('missing_context'));
      const resolvedHint = await resolveReadParameterChoices(hint);
      command = capabilityReadCommandForHint(resolvedHint, selectedConfidence);
    } else {
      command = commandForRoute(selectedRoute, input, readAnswers, requestFeatures);
    }
    if ('kind' in command) return withTelemetry(command);
    const isReadRoute = selectedRoute === 'capability_read' || selectedRoute === 'http_read';
    const transformRequest = isReadRoute
      ? tableTransformRequest(readAnswers.table_transform)
      : undefined;
    const projectionRequest = isReadRoute
      ? tableProjectionRequest(readAnswers.table_projection)
      : undefined;
    const readResultStyle = isReadRoute && toolSelection?.kind === 'selected'
      && toolSelection.needsNaturalLanguageAnswer ? 'summary' : undefined;
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

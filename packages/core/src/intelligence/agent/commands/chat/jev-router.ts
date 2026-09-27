import {
  decisionProviderRequestBytesFromError,
  decisionProviderRequestCountFromError,
  type DecisionInstruction,
  type ChoiceDecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
} from '../../../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { choiceAnswerConfidence } from '../../../decision/confidence.js';
import type { AxCommand } from '../schema.js';
import { availableCapabilities } from '../../../../catalog/capability-graph.js';
import {
  JEV_READ_OPERATION_MAX_CHOICES,
  selectJevReadOperationHints,
  type JevReadOperationHint,
} from '../../../decision/read-operation-catalog.js';
import { selectJevWorkflowTriggerHints } from './jev-workflow-proposal.js';
import {
  compileJevOneShotAction,
  jevActionQuestionGroups,
  selectJevActionHints,
  type JevActionQuestionGroup,
} from './jev-action-catalog.js';
import { planJevWorkflow } from './jev-workflow-plan.js';
import { contextProposalCommand } from './context/proposal.js';
import { reportCommand, reportSourceQuestions, reportSources } from './jev-report-selection.js';
import {
  buildJevDecisionRequest,
  jevReadOperationQuestion,
  jevActionQuestion,
  type JevReadOperationQuestionGroup,
} from './jev-decision-request.js';
import { mapJevQuotedActionInput } from './jev-action-input.js';
import { resolveJevReadOperationParameters } from './jev-read-parameters.js';
import { JEV_CHAT_ROUTE_CRITERIA, type JevChatRouteName } from './jev-route-criteria.js';
import { deriveJevRequestFeatures } from './request-features.js';
import type {
  JevChatRouterInput,
  JevChatRouterResult,
  JevChatRouterTelemetry,
} from './jev-router-contract.js';
export type { JevChatRouterInput, JevChatRouterResult } from './jev-router-contract.js';
import {
  capabilityReadCommand,
  capabilityReadCommandForHint,
  choiceAnswer,
  commandForRoute,
  fallback,
  readResultStyleRequest,
  selectedActionFinalists,
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
        const followup = await evaluateFollowup(followupState, followupQuestions);
        executionAnswers = { ...executionAnswers, ...followup.answers };
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
    const workflowRouteResult = await handleJevWorkflowRoute({
      input,
      route: selectedRoute,
      confidence: selectedConfidence,
      answers: evaluation.answers,
      operationHints,
      actionHints: actionSelection.hints,
      workflowTriggerHints,
      withTelemetry,
      evaluateFollowup,
      workflowPlanResult,
    });
    if (workflowRouteResult) return workflowRouteResult;
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
        const followup = await evaluateFollowup(followupState, followupQuestions);
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
        evaluate: evaluateFollowup,
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
      const followup = await evaluateFollowup(readSelectionState, deferredReadQuestions);
      readAnswers = { ...readAnswers, ...followup.answers };
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
        const followup = await evaluateFollowup(state, followupQuestions);

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
    const isReadRoute = selectedRoute === 'capability_read' || selectedRoute === 'http_read';
    const transformRequest = isReadRoute
      ? tableTransformRequest(readAnswers.table_transform)
      : undefined;
    const projectionRequest = isReadRoute
      ? tableProjectionRequest(readAnswers.table_projection)
      : undefined;
    const readResultStyle = isReadRoute
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

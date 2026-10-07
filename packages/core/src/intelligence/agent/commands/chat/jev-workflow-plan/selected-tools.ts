import type { AuthoritativeRequestAnchor, AuthoritativeRequestBudget } from '../../../../../contracts/request-anchor.js';
import { AuthoritativeRequestError, authoritativeRequestClarification, resolveAuthoritativeRequestAnchor, guardAuthoritativeRequestDecisions } from '../../../../decision/request-anchor.js';
import {
  decisionProviderRequestBytesFromError,
  decisionProviderRequestCountFromError,
  type DecisionEngine,
} from '../../../../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../../decision/context.js';
import { AX_WORKFLOW_UPDATE_MAX_OPERATIONS } from '../../schema/workflow-args.js';
import { MAX_WORKFLOW_STEPS } from '../../../../../workflow/schema/limits.js';
import type { Trigger } from '../../../../../workflow/schema.js';
import type { AxUiPresentation } from '../../schema.js';
import type { JevActionHint, JevActionInputValue } from '../jev-action-catalog.js';
import type { JevWorkflowOutputHint } from '../jev-workflow-plan-types.js';
import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';
import { JEV_RECENT_CONVERSATION_POLICY, type JevChatRequestPlan, type JevCommandPlan } from '../jev-request-plan.js';
import {
  AGENT_SCOPED_CONTEXT_DECISION_POLICY,
  boundedAgentScopedContext,
  type AgentScopedContextMap,
} from '../../../scoped-context.js';
import {
  triggerChoices,
  initialCandidates,
  workflowCommand,
  blankTriggerFields,
  withoutUnusedReads,
  reviewStep,
  composeMessageText,
  type PlannedStep,
  type JevWorkflowPlanResult,
  type JevWorkflowPlanValue,
} from '../jev-workflow-plan-steps.js';
import { createPhaseResolver } from './phase-resolver.js';
import {
  FINAL_REVIEW_QUESTIONS,
  rejectedPlan,
  reviewAccepted,
  reviewedPlanPresentation,
  unsettledPlanPresentation,
} from './plan-review.js';
import { emptyPlanTelemetry, noCommitMessage as noCommitMessageFor, type JevPlanMode } from './shared.js';
import { applyArgumentAnswers, argumentQuestions, assignStepIds } from './selected-tool-arguments.js';
import {
  applyBindingAnswers,
  bindingQuestions,
  plannedActions,
  repairConflictingBindings,
  selectedToolOutputs,
} from './selected-tool-bindings.js';

/** Compiles tools selected together in the first Jev evaluation with independent arguments before dependent bindings and final review. */
export async function planJevSelectedTools(input: {
  decisionEngine: DecisionEngine;
  request: string;
  requestAnchor?: AuthoritativeRequestAnchor;
  requestBudget?: Partial<AuthoritativeRequestBudget>;
  mode: JevPlanMode;
  trigger?: Trigger;
  workflowId?: string;
  workflowVersion?: number;
  existingStepIds?: readonly string[];
  removedStepIds?: readonly string[];
  workflowOutputs?: readonly JevWorkflowOutputHint[];
  connectedConnectors: readonly string[];
  readOperationHints: readonly JevReadOperationHint[];
  actionHints: readonly JevActionHint[];
  actionInputValues?: readonly JevActionInputValue[];
  requestPlan?: JevChatRequestPlan;
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  signal?: AbortSignal;
  maxEvaluatorPhases?: number;
}): Promise<JevWorkflowPlanResult> {
  const startedAt = Date.now();
  const telemetry = emptyPlanTelemetry();
  const models = new Set<string>();
  let presentation: AxUiPresentation | undefined;
  const requestedLimit = input.maxEvaluatorPhases ?? 6;
  const phaseLimit = Math.min(8, Math.floor(requestedLimit));
  const userConfirmedPreferences = boundedAgentScopedContext(input.sessionMemo, input.workflowPolicy);
  const decisionPolicy = [
    DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    input.requestPlan?.request.context.recentTurns.length ? JEV_RECENT_CONVERSATION_POLICY : undefined,
    userConfirmedPreferences ? AGENT_SCOPED_CONTEXT_DECISION_POLICY : undefined,
  ].filter(Boolean).join('\n');
  const noCommitMessage = noCommitMessageFor(input.mode);
  const finish = (result: JevWorkflowPlanValue): JevWorkflowPlanResult => {
    telemetry.durationMs = Date.now() - startedAt;
    telemetry.models = [...models];
    if (!presentation && result.kind === 'clarify') presentation = unsettledPlanPresentation(noCommitMessage);
    return { ...result, telemetry, ...(presentation ? { presentation } : {}) };
  };
  const clarify = (reason: string) => finish({ kind: 'clarify', message: `${reason} ${noCommitMessage}` });

  try {
    input.signal?.throwIfAborted();
    const anchor = resolveAuthoritativeRequestAnchor(input.request,
      input.requestAnchor ?? input.requestPlan?.request.anchor, {}, input.requestBudget);
    if (input.requestPlan?.version === 2 && input.requestPlan.request.message !== anchor.text) {
      throw new AuthoritativeRequestError({ code: 'request_anchor_mismatch' });
    }
    input = { ...input, requestAnchor: anchor,
      decisionEngine: guardAuthoritativeRequestDecisions(input.decisionEngine, anchor, input.requestBudget) };
    if (!Number.isFinite(requestedLimit) || phaseLimit < 1) throw new Error("invalid_phase_limit");
    if (input.mode === 'recurring_workflow' && !input.trigger) {
      return clarify('반복 업무의 시작 조건을 확인하지 못했습니다.');
    }
    if (input.mode === 'workflow_update' && (!input.workflowId?.trim()
      || !Number.isSafeInteger(input.workflowVersion) || (input.workflowVersion ?? 0) < 1)) {
      return clarify('현재 업무의 최신 버전을 확인하지 못해 수정하지 않았습니다.');
    }

    const baseCandidates = initialCandidates({
      connectedConnectors: input.connectedConnectors,
      readOperationHints: input.readOperationHints,
      actionHints: input.actionHints,
      request: input.request,
      actionInputValues: input.actionInputValues ?? [],
    }).filter((candidate) => candidate.readOperationHint
      ? input.readOperationHints.some(({ key }) => key === candidate.readOperationHint!.key)
      : input.actionHints.some(({ capability }) => capability.id === candidate.capability.id));
    if (baseCandidates.length === 0) {
      return clarify('선택된 도구를 실행 계획으로 만들지 못했습니다.');
    }

    const existingIds = new Set(input.existingStepIds ?? []);
    if (existingIds.size !== (input.existingStepIds?.length ?? 0)) throw new Error('duplicate_existing_id');
    const removedIds = new Set((input.removedStepIds ?? []).filter((id) => existingIds.has(id)));
    const remainingCount = existingIds.size - removedIds.size;
    const maxSteps = input.mode === 'workflow_update'
      ? Math.min(MAX_WORKFLOW_STEPS - remainingCount, AX_WORKFLOW_UPDATE_MAX_OPERATIONS)
      : MAX_WORKFLOW_STEPS;
    if (baseCandidates.length > maxSteps || maxSteps < 1) {
      return clarify('한 번의 요청에서 허용하는 업무 단계 수를 초과했습니다.');
    }

    const { entries, stepIds } = assignStepIds(baseCandidates, input.mode, existingIds);
    const inputValues = [...(input.actionInputValues ?? [])];
    const argumentSelection = argumentQuestions(entries, input.request, inputValues);
    if ('failure' in argumentSelection) return clarify(argumentSelection.failure);

    // Typed continuation values are held separately; never redact matching original intent.
    const safeRequest = input.requestAnchor!.text;
    const state = {
      request: safeRequest,
      command_blocks: entries.map(({ candidate, id }) => ({
        step_id: id, capability_id: candidate.capability.id,
        label: boundDecisionString(candidate.capability.label, 120),
        parameters: candidate.capability.params.map(({ name, required }) => ({ name, required })),
        inputs: candidate.capability.io?.inputs ?? {}, outputs: candidate.capability.io?.outputs ?? {},
      })),
      policy: decisionPolicy,
    };
    const resolve = createPhaseResolver({
      decisionEngine: input.decisionEngine,
      signal: input.signal,
      telemetry,
      models,
      phaseLimit,
      defaultContext: state,
    });
    const argumentFailure = applyArgumentAnswers(entries, argumentSelection,
      await resolve('arguments', argumentSelection.questions), inputValues);
    if (argumentFailure) return clarify(argumentFailure);

    // Build bindings only after all independent arguments have been accepted.
    const existingOutputs = input.mode === 'workflow_update'
      ? (input.workflowOutputs ?? []).filter(({ from }) => from === 'trigger'
        || (existingIds.has(from) && !removedIds.has(from)))
      : [];
    const seedOutputs = input.mode === 'recurring_workflow'
      ? triggerChoices(input.trigger)
      : existingOutputs;
    const bindingSelection = bindingQuestions(entries, [...seedOutputs, ...selectedToolOutputs(entries)],
      input.request, inputValues);
    if ('failure' in bindingSelection) return clarify(bindingSelection.failure);
    const bindingAnswers = await resolve('bindings', bindingSelection.questions);
    telemetry.candidateCount = entries.length + bindingSelection.bindingFields.size;
    const bindingFailure = applyBindingAnswers(bindingSelection, bindingAnswers);
    if (bindingFailure) return clarify(bindingFailure);

    const planned = plannedActions(entries, bindingSelection.bindings, input.request, inputValues);
    if ('failure' in planned) return clarify(planned.failure);
    const checked = await repairConflictingBindings({
      planned,
      seedOutputs,
      bindingFields: bindingSelection.bindingFields,
      questions: bindingSelection.questions,
      state,
      reviewBudgetReached: () => telemetry.calls >= phaseLimit - 1,
      resolve,
    });
    if ('failure' in checked) return clarify(checked.failure);
    if (!checked.ok) return clarify('계획의 입력·타입·의존 관계 검사를 통과하지 못했습니다.');
    const ordered = checked.ordered;
    telemetry.plannedStepCount = ordered.length;

    // "Summarize/filter X and send it": the messaging step's prose body would otherwise be a
    // blank host input. Jev decides whether to generate it from a planned data output; the
    // inserted AI text step has no side effects and the send still goes through approval.
    // Leave at least one evaluation for the final review; composition is optional.
    const composition = telemetry.calls >= phaseLimit - 1 ? undefined : await composeMessageText({
      ordered, pendingInputs: checked.pendingInputs, request: input.request, mode: input.mode,
      takenIds: new Set([...stepIds, ...ordered.map(({ id }) => id)]),
      signal: input.signal,
      resolve: (questionSet) => resolve('composition', questionSet, {
        request: safeRequest, policy: decisionPolicy,
        steps: ordered.map(step => ({ id: step.id, capability_id: step.capability.id, outputs: step.capability.io?.outputs ?? {} })),
      }),
    });
    // A recurring job shows nobody an intermediate read; a one-off run may show it as its result.
    const composed = composition?.steps ?? ordered;
    const finalSteps: PlannedStep[] = input.mode === 'recurring_workflow' ? withoutUnusedReads(composed) : composed;
    const keptStepIds = new Set(finalSteps.map((step) => step.kind === 'action' ? step.id : step.step.id));
    const hostInputFields = (composition?.pendingInputs ?? checked.pendingInputs)
      .filter((field) => keptStepIds.has(field.stepId));
    const review = await resolve('final_review', FINAL_REVIEW_QUESTIONS, {
      request: safeRequest, policy: decisionPolicy,
      steps: finalSteps.map((step) => reviewStep(step, safeRequest)),
      // Blank trigger fields (e.g. the schedule) are collected by the host form before saving,
      // exactly like blank action inputs; listing them keeps the review from calling them missing.
      host_input_fields: [...hostInputFields, ...blankTriggerFields(input.trigger)],
      ...(input.trigger ? { trigger: input.trigger } : {}),
    });
    if (!reviewAccepted(review)) {
      const rejected = rejectedPlan(review, finalSteps, noCommitMessage);
      presentation = rejected.presentation;
      return finish({ kind: 'clarify', message: rejected.message });
    }
    presentation = reviewedPlanPresentation(true, finalSteps, hostInputFields.length);

    const commandPlan: JevCommandPlan = {
      commands: ordered.filter((planned) => keptStepIds.has(planned.id)).map((planned) => ({
        id: planned.id,
        operationId: planned.capability.id,
        input: { ...planned.params },
        dependsOn: [...new Set(Object.values(planned.bindings).map(({ from }) => from))],
      })),
    };
    const command = workflowCommand(input.request, finalSteps, input.mode, input.trigger,
      input.mode === 'workflow_update'
        ? { workflowId: input.workflowId!.trim(), workflowVersion: input.workflowVersion! }
        : undefined,
      commandPlan, input.requestAnchor);
    telemetry.plannedStepCount = finalSteps.length;
    return finish({ kind: 'command', command, commandPlan });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof AuthoritativeRequestError) return finish({ kind: 'clarify',
      message: authoritativeRequestClarification(error.failure), requestFailure: error.failure });
    telemetry.providerRequestCount += decisionProviderRequestCountFromError(error) ?? 0;
    telemetry.estimatedRequestBytes += decisionProviderRequestBytesFromError(error) ?? 0;
    return clarify('도구별 명령 블록을 확정하지 못해 중단했습니다.');
  }
}

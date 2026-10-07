import type { AuthoritativeRequestAnchor, AuthoritativeRequestBudget } from '../../../../../contracts/request-anchor.js';
import { AuthoritativeRequestError, authoritativeRequestClarification, resolveAuthoritativeRequestAnchor, guardAuthoritativeRequestDecisions } from '../../../../decision/request-anchor.js';
import {
  decisionProviderRequestBytesFromError,
  decisionProviderRequestCountFromError,
  type DecisionEngine,
  type DecisionQuestion,
} from '../../../../../contracts/decision.js';
import { capabilityActionName } from '../../../../../catalog/capability-graph.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../../decision/context.js';
import { AX_WORKFLOW_UPDATE_MAX_OPERATIONS } from '../../schema/workflow-args.js';
import { MAX_WORKFLOW_STEPS } from '../../../../../workflow/schema/limits.js';
import { hasConcreteParamForPort } from '../../../../../workflow/bindings/ports/params.js';
import { aiDecisionOutputPorts } from '../../../../../workflow/bindings/ports.js';
import type { Trigger } from '../../../../../workflow/schema.js';
import {
  compileJevActionParams,
  type JevActionHint,
  type JevActionInputValue,
} from '../jev-action-catalog.js';
import { mapJevQuotedActionInput } from '../jev-action-input.js';
import { resolveJevReadOperationParameters } from '../jev-read-parameters.js';
import { selectNextPlanCandidate, selectWorkflowBindings } from '../jev-workflow-plan-selection.js';
import type {
  ActionPlanCandidate,
  JevWorkflowOutputHint,
  PlanCandidate,
} from '../jev-workflow-plan-types.js';
import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';
import {
  AGENT_SCOPED_CONTEXT_DECISION_POLICY,
  boundedAgentScopedContext,
  type AgentScopedContextMap,
} from '../../../scoped-context.js';
import {
  outputChoices,
  triggerChoices,
  candidateFor,
  aiTextTransformCandidates,
  buildAiTextStep,
  workflowCommand,
  initialCandidates,
  type PlannedStep,
  type JevWorkflowPlanResult,
  type JevWorkflowPlanValue,
} from '../jev-workflow-plan-steps.js';
import { emptyPlanTelemetry, noCommitMessage as noCommitMessageFor, recordModelUsage, type JevPlanMode } from './shared.js';

/** Plans a workflow one step at a time: each round Jev picks the next step or finishes. */
export async function planJevWorkflow(input: {
  decisionEngine: DecisionEngine;
  request: string;
  requestAnchor?: AuthoritativeRequestAnchor;
  requestBudget?: Partial<AuthoritativeRequestBudget>;
  mode?: JevPlanMode;
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
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  signal?: AbortSignal;
}): Promise<JevWorkflowPlanResult> {
  const mode = input.mode ?? 'one_shot';
  const noCommitMessage = noCommitMessageFor(mode);
  const startedAt = Date.now();
  const telemetry = emptyPlanTelemetry();
  const models = new Set<string>();
  const steps: PlannedStep[] = [];
  const existingWorkflowStepIds = new Set(input.existingStepIds ?? []);
  const removedWorkflowStepIds = new Set((input.removedStepIds ?? []).filter((id) => existingWorkflowStepIds.has(id)));
  const stepIds = new Set(existingWorkflowStepIds);
  const remainingWorkflowStepCount = existingWorkflowStepIds.size - removedWorkflowStepIds.size;
  const maxPlannedSteps = mode === 'workflow_update'
    ? Math.min(MAX_WORKFLOW_STEPS - remainingWorkflowStepCount, AX_WORKFLOW_UPDATE_MAX_OPERATIONS)
    : MAX_WORKFLOW_STEPS;
  const existingWorkflowOutputs = mode === 'workflow_update'
    ? (input.workflowOutputs ?? []).filter(({ from }) => from === 'trigger'
      || (existingWorkflowStepIds.has(from) && !removedWorkflowStepIds.has(from)))
    : [];
  const userConfirmedPreferences = boundedAgentScopedContext(input.sessionMemo, input.workflowPolicy);
  const preferenceContext = userConfirmedPreferences
    ? { user_confirmed_preferences: userConfirmedPreferences }
    : {};
  const decisionPolicy = [
    DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    userConfirmedPreferences ? AGENT_SCOPED_CONTEXT_DECISION_POLICY : undefined,
  ].filter(Boolean).join('\n');
  const baseCandidates = initialCandidates({
    connectedConnectors: input.connectedConnectors,
    readOperationHints: input.readOperationHints,
    actionHints: input.actionHints,
    request: input.request,
    actionInputValues: input.actionInputValues ?? [],
  });

  const finish = (result: JevWorkflowPlanValue): JevWorkflowPlanResult => {
    telemetry.durationMs = Date.now() - startedAt;
    telemetry.plannedStepCount = steps.length;
    telemetry.models = [...models];
    return { ...result, telemetry };
  };

  if (mode === 'recurring_workflow' && !input.trigger) {
    return finish({
      kind: 'clarify',
      message: `반복 업무의 시작 이벤트를 확인하지 못했습니다. ${noCommitMessage}`,
    });
  }
  if (mode === 'workflow_update' && (!input.workflowId?.trim()
    || !Number.isSafeInteger(input.workflowVersion) || (input.workflowVersion ?? 0) < 1)) {
    return finish({
      kind: 'clarify',
      message: `현재 업무의 최신 버전을 확인하지 못해 수정하지 않았습니다. ${noCommitMessage}`,
    });
  }
  if (mode === 'workflow_update' && maxPlannedSteps < 1) {
    return finish({
      kind: 'clarify',
      message: `한 번에 만들거나 바꿀 수 있는 단계 수를 넘었습니다. 요청을 나누어 주세요. ${noCommitMessage}`,
    });
  }

  const nextStepId = () => {
    let suffix = steps.length + 1;
    while (stepIds.has(`jev_step_${suffix}`)) suffix += 1;
    const id = `jev_step_${suffix}`;
    stepIds.add(id);
    return id;
  };

  const evaluate = async (state: unknown, questions: Record<string, DecisionQuestion>) => {
    // Keep dependent planning decisions inside the caller's single request budget.
    input.signal?.throwIfAborted();
    const payload = { state, questions };
    const estimatedRequestBytes = () => new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    telemetry.calls += 1;
    let requestBytesRecorded = false;
    try {
      const result = await input.decisionEngine.evaluate({ ...payload, signal: input.signal });
      telemetry.estimatedRequestBytes += result.requestBytes ?? estimatedRequestBytes();
      requestBytesRecorded = true;
      telemetry.providerRequestCount += result.providerRequestCount ?? 1;
      recordModelUsage(telemetry, models, result);
      input.signal?.throwIfAborted();
      return result;
    } catch (error) {
      if (!requestBytesRecorded) {
        telemetry.estimatedRequestBytes += decisionProviderRequestBytesFromError(error) ?? estimatedRequestBytes();
      }
      telemetry.providerRequestCount += decisionProviderRequestCountFromError(error) ?? 0;
      throw error;
    }
  };

  try {
    const anchor = resolveAuthoritativeRequestAnchor(input.request, input.requestAnchor, {}, input.requestBudget);
    input = { ...input, requestAnchor: anchor,
      decisionEngine: guardAuthoritativeRequestDecisions(input.decisionEngine, anchor, input.requestBudget) };
    const planningIterations = mode === 'workflow_update' ? maxPlannedSteps + 1 : MAX_WORKFLOW_STEPS;
    for (let index = 0; index < planningIterations; index += 1) {
      input.signal?.throwIfAborted();
      const outputs = [
        ...(mode === 'recurring_workflow' ? triggerChoices(input.trigger) : existingWorkflowOutputs),
        ...outputChoices(steps),
      ];
      const choices = baseCandidates.map((candidate) =>
        candidateFor(candidate.key, candidate.capability, candidate.params, outputs, candidate.readOperationHint));
      const viable: PlanCandidate[] = [
        ...choices.filter((candidate): candidate is ActionPlanCandidate => candidate !== undefined),
        ...aiTextTransformCandidates(outputs, steps.length === 0),
      ];
      const atUpdateLimit = mode === 'workflow_update' && steps.length >= maxPlannedSteps;
      const decisionCandidates = atUpdateLimit ? [] : viable;
      telemetry.candidateCount += decisionCandidates.length;
      if (steps.length === 0 && decisionCandidates.length === 0) {
        return finish({
          kind: 'clarify',
          message: `연결된 서비스에서 요청을 시작할 작업을 찾지 못했습니다. 설정에서 필요한 서비스를 연결했는지 확인해 주세요. ${noCommitMessage}`,
        });
      }

      const planState = {
        request: input.request,
        ...preferenceContext,
        ...(mode === 'recurring_workflow' && input.trigger ? {
          trigger: { type: input.trigger.type, outputs: input.trigger ? triggerChoices(input.trigger) : [] },
        } : {}),
        ...(mode === 'workflow_update' ? {
          existing_workflow_outputs: existingWorkflowOutputs.map(({ from, output, type, capabilityId }) => ({
            from_step: from,
            output,
            contract: type,
            capability_id: capabilityId,
          })),
        } : {}),
        planned_steps: steps.map((planned) => planned.kind === 'action'
          ? {
              id: planned.id,
              step_type: 'action',
              capability_id: planned.capability.id,
              label: boundDecisionString(planned.capability.label, 120),
              outputs: planned.capability.io?.outputs ?? {},
            }
          : {
              id: planned.step.id,
              step_type: 'ai_decision',
              goal: boundDecisionString(planned.step.goal, 240),
              outputs: Object.fromEntries(aiDecisionOutputPorts(planned.step).map(({ port, type }) => [port, type])),
            }),
        policy: decisionPolicy,
      };
      const selected = await selectNextPlanCandidate(decisionCandidates, planState, evaluate);
      if (selected === 'done') {
        if (steps.length === 0) {
          return finish({
            kind: 'clarify',
            message: `실행 계획에 넣을 작업을 고르지 못했습니다. 요청을 조금 더 구체적으로 알려 주세요. ${noCommitMessage}`,
          });
        }
        return finish({
          kind: 'command',
          command: workflowCommand(input.request, steps, mode, input.trigger,
            mode === 'workflow_update' ? {
              workflowId: input.workflowId!.trim(),
              workflowVersion: input.workflowVersion!,
            } : undefined, undefined, input.requestAnchor),
        });
      }
      if (!selected) {
        return finish({
          kind: 'clarify',
          message: atUpdateLimit
            ? `한 번에 바꿀 수 있는 ${AX_WORKFLOW_UPDATE_MAX_OPERATIONS}가지 또는 업무 전체 ${MAX_WORKFLOW_STEPS}단계를 넘었습니다. 요청을 나누어 주세요. ${noCommitMessage}`
            : `다음 작업을 확실하게 고르지 못했습니다. 필요한 작업이나 데이터 범위를 더 구체적으로 알려 주세요. ${noCommitMessage}`,
        });
      }
      let candidate = selected;

      if (candidate.kind === 'ai_decision') {
        const stepId = nextStepId();
        steps.push(buildAiTextStep(input.request, candidate.source, stepId));
        continue;
      }

      if (candidate.readOperationHint) {
        const resolved = await resolveJevReadOperationParameters(candidate.readOperationHint, input.request, evaluate);
        candidate = { ...candidate, params: resolved.params, readOperationHint: resolved };
        if ((resolved.missingParameterPaths?.length ?? 0) > 0) {
          return finish({
            kind: 'clarify',
            message: `조회에 필요한 값이 요청에 없습니다 (${resolved.missingParameterPaths!.join(', ')}). 해당 값을 알려 주세요. ${noCommitMessage}`,
          });
        }
      }

      const stepId = nextStepId();
      const actionInput = await mapJevQuotedActionInput({
        capability: candidate.capability,
        userMessage: input.request,
        inputValues: input.actionInputValues,
        stepId,
        context: { planned_steps: planState.planned_steps },
        evaluate,
      });
      if (actionInput.kind === 'uncertain') {
        return finish({
          kind: 'clarify',
          message: `인용한 문구를 ${candidate.capability.label}의 어떤 입력값으로 써야 할지 확실하지 않습니다. 제목·본문처럼 입력 항목을 지정해 주세요. ${noCommitMessage}`,
        });
      }
      const actionInputValues = actionInput.kind === 'mapped'
        ? [...(input.actionInputValues ?? []), actionInput.inputValue]
        : input.actionInputValues ?? [];
      if (actionInput.kind === 'mapped') {
        const mappedParam = actionInput.inputValue.parameterName;
        const mappedStep = {
          type: 'action' as const,
          id: stepId,
          connector: candidate.capability.connector,
          action: capabilityActionName(candidate.capability),
          params: { [mappedParam ?? '']: 'jev-pending-user-input' },
          sideEffect: candidate.capability.sideEffect ?? 'NONE' as const,
        };
        const mappedPorts = new Set(Object.entries(candidate.capability.io?.inputs ?? {}).flatMap(([port, type]) =>
          type === 'TextArtifact' && mappedParam && hasConcreteParamForPort(mappedStep, port) ? [port] : [],
        ));
        for (const port of mappedPorts) delete candidate.bindings[port];
        candidate.ambiguousInputs = candidate.ambiguousInputs.filter(({ port }) => !mappedPorts.has(port));
      }

      if (candidate.ambiguousInputs.length > 0) {
        telemetry.candidateCount += candidate.ambiguousInputs.reduce(
          (total, { choices }) => total + choices.length,
          0,
        );
        const bindingState = {
          request: input.request,
          selected_capability: {
            capability_id: candidate.capability.id,
            label: boundDecisionString(candidate.capability.label, 120),
          },
          prior_steps: planState.planned_steps,
          ...preferenceContext,
          policy: decisionPolicy,
        };
        const selectedBindings = await selectWorkflowBindings(candidate, bindingState, evaluate);
        if (!selectedBindings) {
          return finish({
            kind: 'clarify',
            message: `작업 사이에 전달할 데이터를 명확히 고르지 못했습니다. 어떤 이전 결과를 사용할지 알려 주세요. ${noCommitMessage}`,
          });
        }
        for (const [port, source] of selectedBindings) {
          candidate.bindings[port] = { from: source.from, output: source.output };
        }
      }

      steps.push({
        kind: 'action',
        id: stepId,
        capability: candidate.capability,
        params: {
          ...candidate.params,
          ...compileJevActionParams(candidate.capability, '', actionInputValues, stepId),
        },
        bindings: candidate.bindings,
      });
    }
    return finish({
      kind: 'clarify',
      message: `업무 하나에 넣을 수 있는 ${MAX_WORKFLOW_STEPS}단계를 넘었습니다. 요청을 나누거나 범위를 줄여 주세요. ${noCommitMessage}`,
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof AuthoritativeRequestError) return finish({ kind: 'clarify',
      message: authoritativeRequestClarification(error.failure), requestFailure: error.failure });
    return finish({
      kind: 'clarify',
      message: `판단 엔진(Jev)이 실행 순서를 정하지 못해 멈췄습니다. 설정 > 판단 엔진에서 연결 상태를 확인한 뒤 다시 시도해 주세요. ${noCommitMessage}`,
    });
  }
}

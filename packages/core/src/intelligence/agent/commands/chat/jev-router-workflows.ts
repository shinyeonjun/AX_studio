import type { DecisionAnswer, DecisionQuestion } from '../../../../contracts/decision.js';
import { DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { AxWorkflowUpdateArgsSchema } from '../schema.js';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import type { JevActionHint } from './jev-action-catalog.js';
import {
  compileJevWorkflowUpdate,
  workflowStepRemovalQuestions,
  type JevWorkflowStepCandidate,
} from './jev-workflow-update.js';
import { planJevSelectedTools, type JevWorkflowPlanResult } from './jev-workflow-plan.js';
import type { JevWorkflowTriggerHint } from './jev-workflow-proposal.js';
import { choiceAnswer, fallback, selectedWorkflowStepFinalists } from './jev-router-command.js';
import type { JevChatRouterInput, JevChatRouterResult } from './jev-router-contract.js';
import type { JevChatRequestPlan } from './jev-request-plan.js';
import type { JevChatRouteName } from './jev-route-criteria.js';

export interface JevWorkflowRouteContext {
  input: JevChatRouterInput;
  route: JevChatRouteName;
  confidence: number;
  answers: Record<string, DecisionAnswer>;
  selectedReadHints: readonly JevReadOperationHint[];
  selectedActionHints: readonly JevActionHint[];
  requestPlan?: JevChatRequestPlan;
  workflowTriggerHints: readonly JevWorkflowTriggerHint[];
  withTelemetry: (result: JevChatRouterResult) => JevChatRouterResult;
  evaluateFollowup: (
    state: unknown,
    questions: Record<string, DecisionQuestion>,
  ) => Promise<{ answers: Record<string, DecisionAnswer> }>;
  workflowPlanResult: (
    plan: JevWorkflowPlanResult,
    route: 'workflow_create' | 'workflow_update' | 'execution_enqueue_once' | 'job_propose',
  ) => JevChatRouterResult;
}

export async function handleJevWorkflowRoute(context: JevWorkflowRouteContext): Promise<JevChatRouterResult | undefined> {
  const {
    input,
    route: selectedRoute,
    confidence: selectedConfidence,
    answers,
    workflowTriggerHints,
    withTelemetry,
    evaluateFollowup,
    workflowPlanResult,
  } = context;
  if (selectedRoute === 'workflow_create') {
    const triggerAnswer = choiceAnswer(answers.workflow_trigger);
    // `none` means Jev is unsure; it is not equivalent to explicit manual execution.
    if (!triggerAnswer || triggerAnswer.choice !== 'manual') {
      return withTelemetry({
        kind: 'clarify',
        route: selectedRoute,
        message: '수동 workflow 생성과 반복 시작 조건을 같은 요청으로 판단해 저장하지 않았습니다. 한 번 실행할 업무인지, 일정·이벤트로 반복할 업무인지 확인해 주세요.',
        confidence: selectedConfidence,
      });
    }
    const plan = await planJevSelectedTools({
      decisionEngine: input.decisionEngine,
      request: input.userMessage,
      requestAnchor: input.requestAnchor,
      requestBudget: input.requestBudget,
      mode: 'manual_workflow',
      connectedConnectors: input.connectedConnectors ?? [],
      sessionMemo: input.sessionMemo,
      workflowPolicy: input.workflowPolicy,
      readOperationHints: context.selectedReadHints,
      actionHints: context.selectedActionHints,
      actionInputValues: input.actionInputValues,
      requestPlan: context.requestPlan,
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
    let updateAnswers = answers;
    const workflowSteps = input.currentWorkflowSteps ?? [];
    const removalIntent = choiceAnswer(answers.explicit_workflow_step_removal);
    const additionIntent = choiceAnswer(answers.explicit_workflow_step_addition);
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
        request: input.userMessage,
        requestAnchor: input.requestAnchor,
      requestBudget: input.requestBudget,
        context: { current_workflow_step_count: workflowSteps.length },
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      };
      const evaluateStepCandidates = async (
        candidates: readonly JevWorkflowStepCandidate[],
        questionPrefix = 'workflow_step_to_remove',
      ) => {
        const groups = workflowStepRemovalQuestions(candidates, questionPrefix);
        const stepQuestions = Object.fromEntries(groups.map(({ questionId, question }) => [questionId, question]));
        const stepEvaluation = await evaluateFollowup(updateState, stepQuestions);
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
      updateAnswers = { ...answers, workflow_step_to_remove: finalists[0]!.answer };
    }
    if (additionIntent.choice === 'add_now') {
      const workflowId = input.currentWorkflowId!.trim();
      const removedChoice = choiceAnswer(updateAnswers.workflow_step_to_remove)?.choice.match(/^step_(0|[1-9]\d*)$/u);
      const removedIndex = removedChoice ? Number(removedChoice[1]) : -1;
      const removedStepId = Number.isSafeInteger(removedIndex) ? workflowSteps[removedIndex]?.id : undefined;
      const plan = await planJevSelectedTools({
        decisionEngine: input.decisionEngine,
        request: input.userMessage,
        requestAnchor: input.requestAnchor,
        requestBudget: input.requestBudget,
        mode: 'workflow_update',
        workflowId,
        workflowVersion: input.currentWorkflowVersion,
        existingStepIds: workflowSteps.map(({ id }) => id),
        removedStepIds: removedStepId ? [removedStepId] : [],
        workflowOutputs: input.currentWorkflowOutputs?.filter(({ from }) => from !== removedStepId),
        connectedConnectors: input.connectedConnectors ?? [],
        sessionMemo: input.sessionMemo,
        workflowPolicy: input.workflowPolicy,
        readOperationHints: context.selectedReadHints,
        actionHints: context.selectedActionHints,
        actionInputValues: input.actionInputValues,
        requestPlan: context.requestPlan,
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
  if (selectedRoute === 'job_propose') {
    if (!input.hasWorkspaceSession) {
      return withTelemetry({
        kind: 'clarify',
        route: selectedRoute,
        message: '반복 업무 초안을 만들 현재 대화 세션이 없습니다. 새 대화에서 다시 요청해 주세요.',
        confidence: selectedConfidence,
      });
    }
    const triggerAnswer = choiceAnswer(answers.workflow_trigger);
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
    const plan = await planJevSelectedTools({
      decisionEngine: input.decisionEngine,
      request: input.userMessage,
      requestAnchor: input.requestAnchor,
      requestBudget: input.requestBudget,
      mode: 'recurring_workflow',
      trigger: selectedTrigger.trigger,
      connectedConnectors: input.connectedConnectors ?? [],
      sessionMemo: input.sessionMemo,
      workflowPolicy: input.workflowPolicy,
      readOperationHints: context.selectedReadHints,
      actionHints: context.selectedActionHints,
      actionInputValues: input.actionInputValues,
      requestPlan: context.requestPlan,
      signal: input.abortSignal,
    });
    return workflowPlanResult(plan, selectedRoute);
  }
  return undefined;
}

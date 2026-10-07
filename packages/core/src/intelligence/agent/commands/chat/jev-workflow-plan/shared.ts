import type { DecisionEvaluationResult } from '../../../../../contracts/decision.js';
import type { JevWorkflowPlanTelemetry } from '../jev-workflow-plan-steps.js';

export type JevPlanMode = 'one_shot' | 'manual_workflow' | 'recurring_workflow' | 'workflow_update';

/** Every unfinished plan says plainly that nothing was saved, queued or activated. */
export function noCommitMessage(mode: JevPlanMode): string {
  return mode === 'manual_workflow'
    ? '아무 업무도 저장하지 않았습니다.'
    : mode === 'recurring_workflow'
      ? '아무 반복 업무도 저장하거나 활성화하지 않았습니다.'
      : mode === 'workflow_update'
        ? '아무 업무 변경도 저장하지 않았습니다.'
        : '아무 작업도 큐에 등록하지 않았습니다.';
}

export function emptyPlanTelemetry(): JevWorkflowPlanTelemetry {
  return {
    calls: 0,
    providerRequestCount: 0,
    durationMs: 0,
    plannedStepCount: 0,
    candidateCount: 0,
    candidateCatalogMayBeBounded: false,
    estimatedRequestBytes: 0,
    models: [],
  };
}

/** Folds one evaluation's model and token usage into the plan telemetry. */
export function recordModelUsage(
  telemetry: JevWorkflowPlanTelemetry,
  models: Set<string>,
  result: Pick<DecisionEvaluationResult, 'model' | 'usage'>,
): void {
  if (result.model) models.add(result.model);
  if (result.usage?.inputTokens !== undefined) telemetry.inputTokens = (telemetry.inputTokens ?? 0) + result.usage.inputTokens;
  if (result.usage?.outputTokens !== undefined) telemetry.outputTokens = (telemetry.outputTokens ?? 0) + result.usage.outputTokens;
}

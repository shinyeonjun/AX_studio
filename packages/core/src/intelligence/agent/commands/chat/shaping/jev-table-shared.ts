import type { DecisionAnswer, DecisionEvaluationResult } from '../../../../../contracts/decision.js';

export type JevEvaluationMetadata = {
  providerRequestCount: number;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export function accumulateEvaluationMetadata(
  metadata: JevEvaluationMetadata,
  evaluation: DecisionEvaluationResult,
): void {
  metadata.providerRequestCount += evaluation.providerRequestCount ?? 1;
  if (evaluation.model) metadata.model = evaluation.model;
  if (evaluation.usage) {
    const sum = (previous: number | undefined, current: number | undefined) =>
      previous === undefined && current === undefined ? undefined : (previous ?? 0) + (current ?? 0);
    const inputTokens = sum(metadata.usage?.inputTokens, evaluation.usage.inputTokens);
    const outputTokens = sum(metadata.usage?.outputTokens, evaluation.usage.outputTokens);
    metadata.usage = {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };
  }
}

export function selectedChoice(answer: DecisionAnswer | undefined, allowed: ReadonlySet<string>): string | undefined {
  // The host owns candidate validity; confidence is telemetry, not a veto.
  return answer?.type === 'choice' && allowed.has(answer.choice) ? answer.choice : undefined;
}

import type { DecisionAnswer, DecisionEngine, DecisionQuestion } from '../../../../../contracts/decision.js';
import type { JevWorkflowPlanTelemetry } from '../jev-workflow-plan-steps.js';
import { recordModelUsage } from './shared.js';

export type PhaseQuestions = Record<string, DecisionQuestion>;
export type PhaseResolve = (
  phase: string,
  questions: PhaseQuestions,
  context?: unknown,
) => Promise<Record<string, DecisionAnswer>>;

/**
 * Phase evaluation for the selected-tools planner. Each provider call spends one unit of the
 * phase budget; a resolve keeps asking until every question has a listed choice.
 */
export function createPhaseResolver(input: {
  decisionEngine: DecisionEngine;
  signal?: AbortSignal;
  telemetry: JevWorkflowPlanTelemetry;
  models: Set<string>;
  phaseLimit: number;
  defaultContext: unknown;
}): PhaseResolve {
  const { telemetry } = input;
  const evaluate = async (phase: string, phaseQuestions: PhaseQuestions, context: unknown = input.defaultContext) => {
    input.signal?.throwIfAborted();
    if (telemetry.calls >= input.phaseLimit) throw new Error('phase_budget_exhausted');
    telemetry.calls += 1;
    const payload = { state: { context, phase }, questions: { ...phaseQuestions }, signal: input.signal };
    const result = await input.decisionEngine.evaluate(payload);
    telemetry.providerRequestCount += result.providerRequestCount ?? 1;
    telemetry.estimatedRequestBytes += result.requestBytes ?? new TextEncoder().encode(JSON.stringify({ state: payload.state, questions: phaseQuestions })).byteLength;
    recordModelUsage(telemetry, input.models, result);
    input.signal?.throwIfAborted();
    return result.answers;
  };
  // Only malformed/missing answers are repaired. Valid negative/unclear choices are final.
  return async (phase, phaseQuestions, context = input.defaultContext) => {
    const accepted: Record<string, DecisionAnswer> = {};
    const pending = { ...phaseQuestions };
    let stalled = false;
    while (Object.keys(pending).length) {
      const result = await evaluate(phase, pending, context);
      let progress = false;
      for (const [id, question] of Object.entries(pending)) {
        const answer = result[id];
        if (question.type === 'choice' && answer?.type === 'choice' && Object.hasOwn(question.criteria, answer.choice)) {
          accepted[id] = answer; delete pending[id]; progress = true;
        }
      }
      if (!progress && stalled) throw new Error('no_progress');
      stalled = !progress;
    }
    return accepted;
  };
}

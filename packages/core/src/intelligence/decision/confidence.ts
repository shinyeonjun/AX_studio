import type { ChoiceDecisionAnswer } from '../../contracts/decision.js';

export function choiceAnswerConfidence(answer: ChoiceDecisionAnswer, choice: string): number {
  const confidence = answer.confidence ?? answer.probabilities[choice] ?? 0;
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
}

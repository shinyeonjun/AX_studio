import { MAX_DECISION_CHOICE_CRITERIA, type DecisionInstruction } from '../../../../contracts/decision.js';
import { groupDecisionChoiceCandidates } from '../../../decision/choice-grouping.js';

export const MAX_JEV_CHOICE_CANDIDATES = MAX_DECISION_CHOICE_CRITERIA - 1;

export function groupJevChoiceCandidates<T>(
  candidates: readonly T[],
  questionPrefix: string,
  keyFor: (candidate: T) => string,
  criterionFor: (candidate: T) => DecisionInstruction,
): Array<{ questionId: string; candidates: readonly T[]; criteria: Record<string, DecisionInstruction> }> {
  return groupDecisionChoiceCandidates(candidates, questionPrefix, keyFor, criterionFor,
    MAX_JEV_CHOICE_CANDIDATES);
}

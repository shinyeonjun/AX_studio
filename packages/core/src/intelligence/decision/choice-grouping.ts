import type { DecisionInstruction } from '../../contracts/decision.js';

// ponytail: TypeSafe rejected a 194 KiB synthetic choice with max_tokens_exceeded; 32 KiB keeps candidates intact and fans questions out.
const DECISION_CHOICE_GROUP_BYTE_BUDGET = 32_768;

export function groupDecisionChoiceCandidates<T>(
  candidates: readonly T[],
  questionPrefix: string,
  keyFor: (candidate: T) => string,
  criterionFor: (candidate: T) => DecisionInstruction,
  maxCriteria: number,
): Array<{ questionId: string; candidates: readonly T[]; criteria: Record<string, DecisionInstruction> }> {
  const groups: Array<{ questionId: string; candidates: T[]; criteria: Record<string, DecisionInstruction> }> = [];
  const encoder = new TextEncoder();
  let current: T[] = [];
  let criteria: Record<string, DecisionInstruction> = {};
  let currentBytes = 0;
  const finish = () => {
    groups.push({ questionId: `${questionPrefix}_group_${groups.length}`, candidates: current, criteria });
    current = [];
    criteria = {};
    currentBytes = 0;
  };

  for (const candidate of candidates) {
    const key = keyFor(candidate);
    const criterion = criterionFor(candidate);
    const entry = `${JSON.stringify(key)}:${JSON.stringify(criterion)}`;
    const entryBytes = encoder.encode(entry).byteLength;
    const separatorBytes = current.length > 0 ? 1 : 0;
    if (current.length > 0 && (current.length >= maxCriteria
      || currentBytes + separatorBytes + entryBytes > DECISION_CHOICE_GROUP_BYTE_BUDGET)) finish();
    criteria[key] = criterion;
    currentBytes += (current.length > 0 ? 1 : 0) + entryBytes;
    current.push(candidate);
  }
  if (current.length > 0) finish();
  return groups;
}

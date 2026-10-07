import { randomUUID } from 'node:crypto';
import type { CandidateProgram } from '../schema.js';
import type { ClarificationQuestion } from './types.js';
import { sourceIdFromExpr } from '../compile/blueprint.js';
import { describeMapping, filterSignature } from '../describe-expr.js';

function acceptedCandidates(candidates: CandidateProgram[]): CandidateProgram[] {
  return candidates.filter((candidate) =>
    candidate.status === 'accepted' ||
    (candidate.status !== 'rejected' && candidate.replayResults.length > 0 && candidate.replayResults.every((entry) => entry.pass)),
  );
}

function partitionKey(candidate: CandidateProgram): string {
  const sourceId = sourceIdFromExpr(candidate.expr) ?? 'unknown';
  const expr = candidate.expr;
  const shape = expr.op === 'aggregate'
    ? `${expr.fn}:${expr.column ?? '*'}:${expr.round ?? ''}`
    : expr.op === 'group'
      ? `group:${[expr.by, ...(expr.thenBy ?? []).map((entry) => entry.by)].join('+')}`
      : expr.op;
  const filter = filterSignature(expr);
  return `${candidate.observationPath}|${sourceId}|${shape}${filter ? `|${filter}` : ''}`;
}

function labelForCandidate(candidate: CandidateProgram): string {
  if (candidate.expr.op === 'column') {
    return `${candidate.expr.name} 값`;
  }
  if (candidate.expr.op === 'aggregate' || candidate.expr.op === 'group' || candidate.expr.op === 'ratio') {
    return describeMapping(candidate.expr);
  }
  const sourceId = sourceIdFromExpr(candidate.expr);
  return (sourceId ?? 'unknown').replace(/^(rdb|sheet):/, '');
}

export function detectCandidateAmbiguity(candidates: CandidateProgram[]): boolean {
  const winners = acceptedCandidates(candidates);
  const byPath = new Map<string, Set<string>>();
  for (const candidate of winners) {
    const keys = byPath.get(candidate.observationPath) ?? new Set<string>();
    keys.add(partitionKey(candidate));
    byPath.set(candidate.observationPath, keys);
  }
  return [...byPath.values()].some((keys) => keys.size > 1);
}

export const CONFIRM_RULE_OPTION_VALUE = 'confirm';
export const REJECT_RULE_OPTION_VALUE = 'reject';

/**
 * Asks a person to confirm unambiguous mappings that were only replayed against too few
 * examples. Both options reference the same accepted candidates; the option value decides.
 */
export function buildConfirmationQuestion(params: {
  sessionId: string;
  candidates: CandidateProgram[];
}): ClarificationQuestion | undefined {
  const winners = acceptedCandidates(params.candidates);
  if (winners.length === 0) return undefined;
  const candidateIds = winners.map((candidate) => candidate.id);
  const labels = [...new Set(winners.map(labelForCandidate))].slice(0, 4).join(', ');
  return {
    id: `q_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    sessionId: params.sessionId,
    kind: 'confirm_rule',
    prompt: '예시가 하나뿐이라 찾은 방법이 맞는지 확인이 필요해요. 이 방법으로 확정할까요?',
    context: `찾은 방법: ${labels}. 예시를 하나 더 추가하거나 직접 확인한 뒤에만 업무로 저장할 수 있습니다.`,
    options: [
      { id: 'opt_confirm', label: '이 방법으로 확정', candidateIds, value: CONFIRM_RULE_OPTION_VALUE },
      { id: 'opt_reject', label: '확정하지 않음', candidateIds, value: REJECT_RULE_OPTION_VALUE },
    ],
    affectedObservationPaths: [...new Set(winners.map((candidate) => candidate.observationPath))],
    createdAt: new Date().toISOString(),
  };
}

export function buildClarificationQuestion(params: {
  sessionId: string;
  candidates: CandidateProgram[];
}): ClarificationQuestion | undefined {
  const winners = acceptedCandidates(params.candidates);
  if (!detectCandidateAmbiguity(params.candidates)) return undefined;

  const groups = new Map<string, CandidateProgram[]>();
  for (const candidate of winners) {
    const key = partitionKey(candidate);
    const bucket = groups.get(key) ?? [];
    bucket.push(candidate);
    groups.set(key, bucket);
  }

  const sortedGroups = [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 4);

  if (sortedGroups.length < 2) return undefined;

  const observationPath = sortedGroups[0]![1][0]!.observationPath;
  const options = sortedGroups.map(([key, group], index) => ({
    id: `opt_${index + 1}`,
    label: labelForCandidate(group[0]!),
    candidateIds: group.map((candidate) => candidate.id),
    value: key,
  }));

  return {
    id: `q_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    sessionId: params.sessionId,
    kind: 'choose_rule',
    prompt: '같은 숫자를 만드는 방법이 여러 개예요. 어느 쪽이 맞나요?',
    context: '예시와 맞는 방법이 두 가지 이상이에요. 하나를 골라 주세요.',
    options,
    affectedObservationPaths: [observationPath],
    createdAt: new Date().toISOString(),
  };
}

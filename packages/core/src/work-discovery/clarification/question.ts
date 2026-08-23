import { randomUUID } from 'node:crypto';
import type { TransformExpr } from '../synthesis/transform-dsl.js';
import type { CandidateProgram } from '../schema.js';
import type { ClarificationQuestion } from './types.js';
import { sourceIdFromExpr } from '../compile/blueprint.js';

function acceptedCandidates(candidates: CandidateProgram[]): CandidateProgram[] {
  return candidates.filter((candidate) =>
    candidate.status === 'accepted' ||
    (candidate.status !== 'rejected' && candidate.replayResults.length > 0 && candidate.replayResults.every((entry) => entry.pass)),
  );
}

function partitionKey(candidate: CandidateProgram): string {
  const sourceId = sourceIdFromExpr(candidate.expr) ?? 'unknown';
  const aggregate = candidate.expr.op === 'aggregate' ? `${candidate.expr.fn}:${candidate.expr.column ?? '*'}` : candidate.expr.op;
  return `${candidate.observationPath}|${sourceId}|${aggregate}`;
}

function labelForCandidate(candidate: CandidateProgram): string {
  if (candidate.expr.op === 'aggregate') {
    const column = candidate.expr.column ?? '전체';
    return `${candidate.expr.fn.toUpperCase()}(${column})`;
  }
  if (candidate.expr.op === 'column') {
    return `${candidate.expr.name} 값`;
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
    context: '재현에 성공한 후보가 둘 이상이라 확인이 필요합니다.',
    options,
    affectedObservationPaths: [observationPath],
    createdAt: new Date().toISOString(),
  };
}

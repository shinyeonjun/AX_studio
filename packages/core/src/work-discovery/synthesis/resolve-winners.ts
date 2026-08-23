import type { CandidateProgram } from '../schema.js';
import { partitionKey } from '../compile/blueprint.js';

export function resolveReplayWinners(
  candidates: CandidateProgram[],
  requiredPaths: string[],
): { candidates: CandidateProgram[]; ambiguousPaths: string[] } {
  const passing = candidates.filter((candidate) =>
    candidate.replayResults.length > 0 && candidate.replayResults.every((entry) => entry.pass),
  );
  const groupsByPath = new Map<string, Map<string, CandidateProgram>>();

  for (const candidate of passing) {
    const key = partitionKey(candidate);
    const pathGroups = groupsByPath.get(candidate.observationPath) ?? new Map<string, CandidateProgram>();
    const existing = pathGroups.get(key);
    if (!existing || candidate.score.total > existing.score.total) {
      pathGroups.set(key, candidate);
    }
    groupsByPath.set(candidate.observationPath, pathGroups);
  }

  const ambiguousPaths: string[] = [];
  const winnerIds = new Set<string>();

  for (const path of requiredPaths) {
    const pathGroups = groupsByPath.get(path);
    if (!pathGroups || pathGroups.size === 0) continue;
    if (pathGroups.size > 1) {
      ambiguousPaths.push(path);
      for (const candidate of pathGroups.values()) winnerIds.add(candidate.id);
      continue;
    }
    winnerIds.add([...pathGroups.values()][0]!.id);
  }

  const nextCandidates = candidates.map((candidate) => {
    if (!passing.some((entry) => entry.id === candidate.id)) {
      return { ...candidate, status: 'candidate' as const };
    }
    if (winnerIds.has(candidate.id)) {
      const pathGroups = groupsByPath.get(candidate.observationPath);
      const isAmbiguous = ambiguousPaths.includes(candidate.observationPath);
      if (isAmbiguous) {
        return { ...candidate, status: 'accepted' as const };
      }
      const winner = [...(pathGroups?.values() ?? [])][0];
      return { ...candidate, status: candidate.id === winner?.id ? 'accepted' as const : 'rejected' as const };
    }
    return { ...candidate, status: 'rejected' as const };
  });

  return { candidates: nextCandidates, ambiguousPaths };
}

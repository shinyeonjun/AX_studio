import type { CandidateProgram, DiscoverySessionState } from '../schema.js';
import type { ClarificationQuestion } from './types.js';
import { buildDiscoveryBlueprint } from '../compile/blueprint.js';

function markCandidates(
  candidates: CandidateProgram[],
  selectedIds: Set<string>,
): CandidateProgram[] {
  return candidates.map((candidate) => {
    if (!selectedIds.has(candidate.id)) {
      return { ...candidate, status: 'rejected' as const };
    }
    return {
      ...candidate,
      status: 'accepted' as const,
    };
  });
}

export function applyClarificationAnswer(
  session: DiscoverySessionState,
  question: ClarificationQuestion,
  optionId: string,
): DiscoverySessionState {
  const option = question.options.find((entry) => entry.id === optionId);
  if (!option) {
    throw new Error('clarification_option_not_found');
  }

  const selectedIds = new Set(option.candidateIds);
  const candidates = markCandidates(session.candidates, selectedIds);
  const next: DiscoverySessionState = {
    ...session,
    revision: session.revision + 1,
    status: 'ready_to_publish',
    candidates,
    pendingQuestion: undefined,
    updatedAt: new Date().toISOString(),
  };
  next.blueprint = buildDiscoveryBlueprint(next);
  return next;
}

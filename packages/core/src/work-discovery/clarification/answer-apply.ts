import type { CandidateProgram, DiscoverySessionState } from '../schema.js';
import type { ClarificationQuestion } from './types.js';
import { buildDiscoveryBlueprint, canPublish } from '../compile/blueprint.js';
import { buildClarificationQuestion } from './question.js';

export function applyClarificationAnswer(
  session: DiscoverySessionState,
  question: ClarificationQuestion,
  optionId: string,
): DiscoverySessionState {
  const option = question.options.find((entry) => entry.id === optionId);
  if (!option) {
    throw new Error('clarification_option_not_found');
  }

  const affectedPaths = new Set(question.affectedObservationPaths);
  const selectedIds = new Set(option.candidateIds);
  const candidates: CandidateProgram[] = session.candidates.map((candidate) => {
    if (!affectedPaths.has(candidate.observationPath)) {
      return candidate;
    }
    if (selectedIds.has(candidate.id)) {
      return { ...candidate, status: 'accepted' as const };
    }
    return { ...candidate, status: 'rejected' as const };
  });

  const pendingQuestion = buildClarificationQuestion({
    sessionId: session.id,
    candidates,
  });

  const next: DiscoverySessionState = {
    ...session,
    revision: session.revision + 1,
    status: pendingQuestion ? 'needs_clarification' : 'ready_to_publish',
    candidates,
    pendingQuestion,
    updatedAt: new Date().toISOString(),
  };
  if (!pendingQuestion && canPublish(next).ok) {
    next.blueprint = buildDiscoveryBlueprint(next);
  } else {
    next.blueprint = undefined;
  }
  return next;
}

import type { CandidateProgram, DiscoverySessionState } from '../schema.js';
import type { ClarificationQuestion } from './types.js';
import { buildDiscoveryBlueprint, canPublish } from '../compile/blueprint.js';
import { buildClarificationQuestion, REJECT_RULE_OPTION_VALUE } from './question.js';

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
  const now = new Date().toISOString();
  if (question.kind === 'confirm_rule' && option.value === REJECT_RULE_OPTION_VALUE) {
    // A person declined the only mapping found; never leave it publishable.
    return {
      ...session,
      revision: session.revision + 1,
      status: 'failed',
      candidates: session.candidates.map((candidate) => affectedPaths.has(candidate.observationPath)
        ? { ...candidate, status: 'rejected' as const }
        : candidate),
      pendingQuestion: undefined,
      blueprint: undefined,
      errorCode: 'human_rejected_mapping',
      errorMessage: '찾은 방법을 확정하지 않아 업무로 저장하지 않았습니다. 예시를 추가해 다시 시작해 주세요.',
      updatedAt: now,
    };
  }

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
    // Any answered question is an explicit human decision about this session's mappings.
    humanConfirmedAt: now,
    updatedAt: now,
  };
  if (!pendingQuestion && canPublish(next).ok) {
    next.blueprint = buildDiscoveryBlueprint(next);
  } else {
    next.blueprint = undefined;
  }
  return next;
}

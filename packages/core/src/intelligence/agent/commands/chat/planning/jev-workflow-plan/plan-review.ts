import type { DecisionAnswer } from '../../../../../../contracts/decision.js';
import type { AxUiPresentation } from '../../../schema.js';
import { stepLabel, type PlannedStep } from '../jev-workflow-plan-steps.js';
import type { PhaseQuestions } from './phase-resolver.js';

type ReviewAnswers = Record<string, DecisionAnswer>;

export const FINAL_REVIEW_QUESTIONS: PhaseQuestions = {
  requirements: { type: 'choice', instructions: 'Does this typed plan meet all requested requirements, conditional on listed host input forms? When the user asks to summarize, draft, send, or notify via a messaging tool (e.g. Slack, Gmail) and the corresponding messaging operation step is included, treat listed host input fields (e.g. channel, text, recipient, trigger schedule) as fulfilling the requirement via host UI composer. Missing operations cannot be invented. Choose unclear when metadata cannot establish adequacy.', criteria: { met: 'All requirements represented', missing: 'A requirement is missing', unclear: 'Cannot determine' } },
  scope: { type: 'choice', instructions: 'Does this plan preserve the user scope without adding actions, destinations or permissions? Model agreement never authorizes execution.', criteria: { preserved: 'Only requested scope', expanded: 'Unrequested scope added', unclear: 'Cannot determine' } },
};

export function reviewAccepted(review: ReviewAnswers): boolean {
  return review.requirements?.type === 'choice' && review.requirements.choice === 'met'
    && review.scope?.type === 'choice' && review.scope.choice === 'preserved';
}

/** Shown when planning stops before a reviewed plan exists. */
export function unsettledPlanPresentation(noCommitMessage: string): AxUiPresentation {
  return {
    title: '실행 전 계획 확인', role: 'diagnostic', inputMode: 'individual', inputs: [], actions: [],
    blocks: [
      { type: 'decision', label: '계획 상태', value: '미확정 · 중단' },
      { type: 'note', text: noCommitMessage },
    ],
  };
}

export function reviewedPlanPresentation(
  accepted: boolean,
  finalSteps: readonly PlannedStep[],
  hostInputCount: number,
): AxUiPresentation {
  return {
    title: '실행 전 계획 확인', role: 'diagnostic', inputMode: 'individual', inputs: [], actions: [],
    blocks: [
      { type: 'decision', label: '단계 연결', value: '확인됨' },
      { type: 'decision', label: '요청과 일치', value: accepted ? '확인됨' : '추가 확인 필요' },
      { type: 'steps', title: '실행 순서', items: finalSteps.slice(0, 20).map(stepLabel) },
      { type: 'note', text: `실행 완료나 승인이 아닙니다. 필요한 입력 ${hostInputCount}개와 외부 변경 승인은 기존 실행 절차에서 확인합니다.` },
    ],
  };
}

/**
 * A rejected plan is the user's next step, not an internal diagnostic: show why and the
 * steps that were considered so the request can be made more specific.
 */
export function rejectedPlan(
  review: ReviewAnswers,
  finalSteps: readonly PlannedStep[],
  noCommitMessage: string,
): { presentation: AxUiPresentation; message: string } {
  const reasons = [
    review.requirements?.type === 'choice' && review.requirements.choice === 'missing' ? '요청한 내용 중 계획에 빠진 부분이 있습니다' : undefined,
    review.requirements?.type === 'choice' && review.requirements.choice === 'unclear' ? '계획이 요청을 모두 담았는지 판단하지 못했습니다' : undefined,
    review.scope?.type === 'choice' && review.scope.choice === 'expanded' ? '요청하지 않은 동작이나 대상이 계획에 들어갔습니다' : undefined,
    review.scope?.type === 'choice' && review.scope.choice === 'unclear' ? '계획 범위가 요청과 같은지 판단하지 못했습니다' : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  const reasonText = reasons.length > 0 ? reasons.join(', ') : '계획이 요청과 맞는지 확인하지 못했습니다';
  return {
    presentation: {
      title: '업무 계획을 확정하지 못했습니다', inputMode: 'individual', inputs: [], actions: [],
      blocks: [
        { type: 'decision', label: '검토 결과', value: reasonText },
        { type: 'steps', title: '검토한 단계', items: finalSteps.slice(0, 20).map(stepLabel) },
        { type: 'note', text: `대상(채널·받는 사람), 조건, 실행 시점을 더 구체적으로 알려주시면 다시 계획합니다. ${noCommitMessage}` },
      ],
    },
    message: `업무 계획을 확정하지 못했습니다. ${reasonText}. 대상·조건·실행 시점을 더 구체적으로 알려주세요. ${noCommitMessage}`,
  };
}

import type { WorkScope } from '../session/work-scope.js';
import type { CompletenessResult, SlotState } from './types.js';

export function formatSlotStateLine(slot: SlotState): string {
  const label = slot.label ? ` (${slot.label})` : '';
  return `- ${slot.slot}${label}`;
}

export function formatMissingSlotsForPrompt(result: CompletenessResult): string {
  const missing = result.slots.filter((slot) => !slot.filled);
  if (missing.length === 0) return '없음';
  return missing.map(formatSlotStateLine).join('\n');
}

export function formatSlotValuesForPrompt(slotValues: Record<string, unknown> | undefined): string {
  const entries = Object.entries(slotValues ?? {});
  if (entries.length === 0) return '(없음)';
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
}

export function buildInterviewTurnHints(input: {
  sessionHints: string;
  hasPartialPlan: boolean;
  missingRequired: string[];
  workScope?: WorkScope;
}): string {
  const lines: string[] = [];
  if (input.sessionHints.trim() && input.sessionHints.trim() !== '(없음)') {
    lines.push(input.sessionHints.trim());
  }
  if (input.hasPartialPlan && input.missingRequired.length > 0) {
    lines.push('- plan이 이미 있습니다. 구조 변경 없이 kind=patch로 missing_slots만 채우세요.');
    lines.push('- patch.set 키는 노드 단위 slot id (`노드id.params.필드명`)를 사용하세요.');
    lines.push(`- 코드가 지금 묻는 슬롯: ${input.missingRequired[0]}. 사용자 답을 이 키에 넣으세요. 말한 다른 missing slot도 같은 턴에 넣어도 됩니다.`);
    lines.push('- nextQuestion은 비워 두세요. 다음 질문은 코드가 고릅니다.');
    lines.push('- `1. 2. 3.` 번호 목록은 만들지 마세요.');
    if (input.workScope === 'recurring') {
      lines.push('- 시작 조건(trigger)도 사용자 답을 patch.set으로 반영하세요. 묻지는 마세요.');
    }
    lines.push('- 연결·action 목록은 이미 컨텍스트에 있습니다. discover로 다시 조회하지 마세요.');
  } else if (!input.hasPartialPlan) {
    lines.push('- 이번 턴은 반드시 kind=plan으로 전체 노드 그래프를 그리세요. params 값은 비워 두어도 됩니다.');
    lines.push('- action 노드는 catalog의 actionRef(예: slack.message.send@1)를 쓰세요. 도구를 직접 실행하지 마세요.');
    lines.push('- nextQuestion은 비워 두세요. 연결·폴더·파일·action 목록은 아래 세션 상태에 있습니다. 이미 있으면 discover하지 마세요.');
  }
  return lines.length > 0 ? lines.join('\n') : '(없음)';
}

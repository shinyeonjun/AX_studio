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
    lines.push('- plan이 이미 있습니다. 구조 변경 없이 patch로 missing_slots만 채우세요.');
    lines.push('- patch.set 키는 노드 단위 slot id (`노드id.params.필드명`)를 사용하세요.');
    lines.push('- 빈 값은 nextQuestion으로 한 번에 하나만 자연스럽게 묻고, 사용자 답을 patch.set에 반영하세요.');
    lines.push('- `1. 2. 3.` 번호 목록은 만들지 마세요.');
    if (input.workScope === 'recurring') {
      lines.push('- 시작 조건(trigger)도 채팅으로 묻고 patch.set으로 반영하세요.');
    }
    lines.push('- 연결은 이미 확인되어 있습니다. discover로 다시 조회하지 마세요.');
  } else if (!input.hasPartialPlan) {
    lines.push('- 이번 턴은 반드시 kind=plan으로 전체 노드 그래프를 그리세요. 값은 비워 두어도 됩니다.');
    lines.push('- 연결·폴더·파일은 아래 세션 상태에 있습니다. 이미 있으면 discover하지 마세요.');
  }
  return lines.length > 0 ? lines.join('\n') : '(없음)';
}

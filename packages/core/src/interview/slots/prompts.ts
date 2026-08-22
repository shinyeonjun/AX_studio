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
  hasDraft: boolean;
  missingRequired: string[];
  workScope?: WorkScope;
}): string {
  const lines: string[] = [];
  if (input.sessionHints.trim() && input.sessionHints.trim() !== '(없음)') {
    lines.push(input.sessionHints.trim());
  }
  if (input.hasDraft && input.missingRequired.length > 0) {
    lines.push('- 현재 draft가 있습니다. 필요한 값은 typed patch로 반영하고 기존 graph를 보존하세요.');
    lines.push('- patch.set 키는 노드 단위 slot id (`노드id.params.필드명`)를 사용하세요.');
    lines.push('- userInstruction과 이전 사용자 답에 이미 있는 분류 기준·채널·메일 주소는 patch.set으로 채우세요. 코드가 다시 묻지 않게 하세요.');
    lines.push('- connected_resources에 PDF path가 있으면 document.ingest params.file에 넣으세요. 목록이 없을 때만 sources.files.list를 씁니다.');
    lines.push('- success(완료 조건)도 patch.meta에 넣으세요. 사용자에게 이미 확인한 값을 다시 묻지 마세요.');
    lines.push(`- 코드가 지금 묻는 슬롯: ${input.missingRequired[0]}. 사용자 답을 이 키에 넣으세요. 말한 다른 missing slot도 같은 턴에 넣어도 됩니다.`);
    lines.push('- `1. 2. 3.` 번호 목록은 만들지 마세요.');
    if (input.workScope === 'recurring') {
      lines.push('- 시작 조건(trigger)도 사용자 답을 patch.set으로 반영하세요. 묻지는 마세요.');
    }
    lines.push('- 확실하지 않은 연결·파일·action은 read-only design tool로 조회하세요. 추측하지 마세요.');
  } else if (!input.hasDraft) {
    lines.push('- draft가 없으면 필요한 연결·파일·capability를 read-only tool로 확인한 뒤 typed patch로 graph를 만드세요.');
    lines.push('- action 노드는 capability 목록의 actionRef(예: slack.message.send@1)를 쓰세요. 도구를 직접 실행하지 마세요.');
  }
  return lines.length > 0 ? lines.join('\n') : '(없음)';
}

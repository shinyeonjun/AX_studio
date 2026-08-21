import { getCapability } from '../../catalog/capabilities.js';
import { getConnectorLabel } from '../../catalog/connectors.js';
import { safeFormatCondition } from '../../runtime/condition-expr.js';
import type { CompletenessResult } from '../../interview/slots/requiredness.js';
import type { InterviewDraft } from '../../interview/draft/schema.js';
import { primaryParamValue, summaryFromGoalOrCapability, truncate, triggerLines } from './helpers.js';
import type { TriggerDisplay, TriggerDisplayResult } from './types.js';

function triggerParamValues(draft: InterviewDraft): Record<string, string | undefined> {
  switch (draft.triggerType) {
    case 'gmail.new_message':
      return { accountId: draft.gmailAccount?.trim() };
    case 'slack.new_message':
      return { channel: draft.slackChannel?.trim() };
    case 'local_folder.new_file':
      return {
        folderId: draft.localFolderId?.trim(),
        folderPath: draft.localFolderPath?.trim(),
        extensions: draft.localFolderExtensions?.trim(),
      };
    case 'schedule':
      return { schedule: draft.schedule?.trim(), timezone: draft.timezone?.trim() };
    case 'once':
      return { runAt: draft.runAt?.trim() };
    default:
      return {};
  }
}

function triggerLabel(draft: InterviewDraft, slots?: CompletenessResult['slots']): TriggerDisplayResult {
  const values = triggerParamValues(draft);

  if (draft.triggerType === 'manual') {
    const summary = draft.goal?.trim() ? truncate(draft.goal, 24) : '수동 실행';
    return {
      label: '수동',
      lines: [],
      tooltip: summary,
      iconConnector: undefined,
      card: {
        header: 'Trigger',
        brand: 'Manual',
        brandStyle: 'bracket',
        summary,
      },
    };
  }

  if (draft.triggerType === 'once') {
    const runAt = values.runAt;
    const summary = runAt ? truncate(runAt, 22) : '1회 실행';
    return {
      label: '1회',
      lines: [{ text: runAt ? runAt : '시각: ?', complete: Boolean(runAt) }],
      tooltip: runAt ? `1회 · ${runAt}` : '1회 · 시각 미설정',
      iconConnector: undefined,
      card: {
        header: 'Trigger',
        brand: 'Once',
        brandStyle: 'bracket',
        summary,
      },
    };
  }

  if (draft.triggerType === 'schedule') {
    const schedule = values.schedule;
    const summary = schedule ? truncate(schedule, 22) : '예약 실행';
    return {
      label: '예약',
      lines: [{ text: schedule ? schedule : '스케줄: ?', complete: Boolean(schedule) }],
      tooltip: schedule ? `예약 · ${schedule}` : '예약 · 스케줄 미설정',
      iconConnector: undefined,
      card: {
        header: 'Trigger',
        brand: 'Schedule',
        brandStyle: 'bracket',
        summary,
      },
    };
  }

  if (!draft.triggerType) {
    return {
      label: '시작 조건 필요',
      lines: [{ text: '시작 조건을 선택하세요', complete: false }],
      tooltip: '시작 조건 미설정',
      iconConnector: undefined,
      card: {
        header: 'Trigger',
        brand: '미설정',
        brandStyle: 'bracket',
        summary: '시작 조건 필요',
      },
    };
  }

  const cap = getCapability(draft.triggerType);
  if (!cap) {
    return {
      label: draft.triggerType,
      lines: [],
      tooltip: draft.triggerType,
      card: {
        header: 'Trigger',
        brand: 'Trigger',
        brandStyle: 'bracket',
        summary: draft.triggerType,
      },
    };
  }

  const lines = triggerLines(cap, values, slots);
  if (draft.triggerFilter) {
    lines.push({ text: `조건: ${safeFormatCondition(draft.triggerFilter)}`, complete: true });
  }
  const primary = primaryParamValue(cap, values);
  const summary = primary ? truncate(primary, 24) : truncate(cap.label, 24);
  const detail = lines.map((line) => line.text).join(' · ');

  return {
    label: getConnectorLabel(cap.connector),
    lines,
    tooltip: detail ? `${cap.label} · ${detail}` : cap.label,
    iconConnector: cap.connector,
    card: {
      header: 'Trigger',
      brand: getConnectorLabel(cap.connector),
      brandStyle: cap.connector === 'slack' ? 'plain' : 'bracket',
      summary,
      captionSub: primary && primary !== summary ? truncate(primary, 22) : undefined,
    },
  };
}

export function displayForTrigger(
  draft: InterviewDraft,
  slots?: CompletenessResult['slots'],
): TriggerDisplay {
  const base = triggerLabel(draft, slots);
  const incomplete = base.lines.some((line) => !line.complete);
  return { ...base, incomplete };
}

export function editPromptForTrigger(): string {
  return '언제 이 업무를 시작할지 어떻게 바꿀까요?';
}

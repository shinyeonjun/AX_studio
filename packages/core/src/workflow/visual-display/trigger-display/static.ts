import type { CompletenessResult } from '../../canvas/slots/requiredness.js';
import type { WorkflowCanvasDraft } from '../../canvas/draft/schema.js';
import { truncate } from '../helpers.js';
import type { TriggerDisplayResult } from '../types.js';
import type { TriggerParamValues } from './values.js';

export function staticTriggerDisplay(
  draft: WorkflowCanvasDraft,
  values: TriggerParamValues,
  _slots?: CompletenessResult['slots'],
): TriggerDisplayResult | undefined {
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

  return undefined;
}

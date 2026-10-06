import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { decodeScheduleInputValue, withoutScheduleTokens } from '@ax-studio/core/schedule';
import { WorkspaceAssistantPresentation } from '../WorkspaceAssistantPresentation.js';
import { ScheduleInputFields } from './schedule-input.js';
import {
  defaultScheduleDraft,
  evaluateScheduleDraft,
  REPEAT_OPTIONS,
  WEEKDAY_OPTIONS,
  type MonthlyMode,
  type ScheduleDraft,
} from './schedule-form-model.js';

/** Words a non-developer must never read in the schedule UI. */
const JARGON = /cron|rrule|freq|byday|bymonth|minutely|weekly|monthly|yearly|\*|\bMO\b|\bTU\b|\bWE\b|\bTH\b|\bFR\b|\bSA\b|\bSU\b/iu;
const NOW = new Date('2026-10-06T00:00:00Z');
const base = defaultScheduleDraft(NOW, 'Asia/Seoul');

/** Visible text only: tags and attribute values (option values, ids) are not shown to users. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/gu, ' ').replace(/&[a-z]+;/gu, ' ');
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('schedule form', () => {
  const drafts: ScheduleDraft[] = REPEAT_OPTIONS.flatMap(({ value: repeat }) =>
    (repeat === 'monthly' ? (['day', 'nth', 'last'] as MonthlyMode[]) : ['day' as MonthlyMode])
      .map((monthlyMode) => ({ ...base, repeat, monthlyMode, weekdays: ['MO', 'WE'] as ScheduleDraft['weekdays'], times: ['09:00', '18:30'] })));

  it.each(drafts.map((draft) => [`${draft.repeat}/${draft.monthlyMode}`, draft] as const))(
    'renders %s in plain Korean with a next-run preview and no jargon',
    (_name, draft) => {
      const text = visibleText(renderToStaticMarkup(
        <ScheduleInputFields disabled={false} onChange={() => undefined} initialDraft={draft} />,
      ));
      expect(text).not.toMatch(JARGON);
      expect(text).toContain('반복');
      expect(text).toContain('시작일');
      expect(text).toContain('시간대');
      expect(text).toContain('다음 실행');
    },
  );

  it('labels every control for assistive technology', () => {
    const markup = renderToStaticMarkup(
      <ScheduleInputFields disabled={false} onChange={() => undefined} initialDraft={{ ...base, repeat: 'biweekly' }} />,
    );
    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toMatch(/<legend>요일/u);
    expect(markup).toMatch(/aria-label="실행 시각 1"/u);
    // Every <select> and date input is named by a <label for> or aria-label.
    for (const match of markup.matchAll(/<(select|input)\b([^>]*)>/gu)) {
      const attributes = match[2]!;
      const id = /id="([^"]+)"/u.exec(attributes)?.[1];
      const named = /aria-label="/u.test(attributes) || /type="(checkbox|radio)"/u.test(attributes)
        || (id !== undefined && markup.includes(`for="${id}"`));
      expect(named, match[0]).toBe(true);
    }
  });

  it('is offered as the host input for a schedule request, never as a text field', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        inputRequests={[{ id: 'schedule', label: '실행 일정', type: 'schedule', required: true, target: 'trigger', parameterName: 'recurrence', reason: '언제 반복할지 골라 주세요.' }]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );
    const text = visibleText(markup);
    expect(text).toContain('실행 일정');
    expect(text).toContain('매일 오전 9:00');
    expect(text).not.toMatch(JARGON);
    expect(markup).not.toMatch(/placeholder="0 9/u);
  });

  it.each(Array.from({ length: 120 }, (_, index) => index + 1))('random choices give a decodable rule or a plain message (seed %i)', (seed) => {
    const random = seeded(seed);
    const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
    const draft: ScheduleDraft = {
      ...base,
      repeat: pick(REPEAT_OPTIONS).value,
      everyMinutes: pick([5, 10, 15, 20, 30]),
      everyHours: pick([1, 2, 3, 4, 6, 12]),
      weekdays: WEEKDAY_OPTIONS.filter(() => random() < 0.4).map(({ value }) => value),
      monthlyMode: pick(['day', 'nth', 'last'] as const),
      monthDay: 1 + Math.floor(random() * 31),
      nth: pick([1, 2, 3, 4, 5, -1]),
      nthWeekday: pick(WEEKDAY_OPTIONS).value,
      month: 1 + Math.floor(random() * 12),
      times: Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
        `${String(Math.floor(random() * 24)).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}`),
      startDate: pick(['2026-10-06', '2027-02-28', '2028-02-29']),
      timezone: pick(['Asia/Seoul', 'America/New_York', 'Europe/London']),
    };
    const result = evaluateScheduleDraft(draft, NOW);
    if (!result.ok) {
      expect(result.message).not.toMatch(JARGON);
      return;
    }
    expect(decodeScheduleInputValue(result.value)).toEqual(result.recurrence);
    expect(withoutScheduleTokens(`실행 일정: ${result.value}`)).toBe(`실행 일정: ${result.description}`);
    expect(`${result.description} ${result.preview.join(' ')}`).not.toMatch(JARGON);
    expect(result.preview.length).toBeGreaterThan(0);
  });
});

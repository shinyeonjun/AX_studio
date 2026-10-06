import { useEffect, useId, useMemo, useState } from 'react';
import type { WeekdayCode } from '@ax-studio/core/schedule';
import {
  defaultScheduleDraft,
  evaluateScheduleDraft,
  HOUR_STEPS,
  MINUTE_STEPS,
  NTH_OPTIONS,
  REPEAT_OPTIONS,
  timeZoneOptions,
  WEEKDAY_OPTIONS,
  type MonthlyMode,
  type ScheduleDraft,
} from './schedule-form-model.js';

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * Structured schedule picker for non-developers: repeat, days, times, start
 * date and time zone, with a live preview of the next runs. It reports the
 * encoded schedule through `onChange` ('' while the choices are incomplete).
 */
export function ScheduleInputFields({
  disabled,
  labelledBy,
  describedBy,
  onChange,
  initialDraft,
}: {
  disabled: boolean;
  labelledBy?: string;
  describedBy?: string;
  onChange: (value: string) => void;
  initialDraft?: ScheduleDraft;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => initialDraft ?? defaultScheduleDraft());
  const result = useMemo(() => evaluateScheduleDraft(draft), [draft]);
  const computerZone = useMemo(() => defaultScheduleDraft().timezone, []);
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const update = (patch: Partial<ScheduleDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const value = result.ok ? result.value : '';

  useEffect(() => {
    onChange(value);
    // onChange identity changes on every parent render; only the value matters.
  }, [value]);

  const usesTimes = draft.repeat !== 'minutes' && draft.repeat !== 'hours';
  const toggleWeekday = (day: WeekdayCode) => update({
    weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((entry) => entry !== day) : [...draft.weekdays, day],
  });

  return (
    <div className="ax-schedule-input" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <div className="ax-schedule-input-row">
        <label htmlFor={field('repeat')}>반복</label>
        <select id={field('repeat')} value={draft.repeat} disabled={disabled}
          onChange={(event) => update({ repeat: event.target.value as ScheduleDraft['repeat'] })}>
          {REPEAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {draft.repeat === 'minutes' && (
        <div className="ax-schedule-input-row">
          <label htmlFor={field('minutes')}>간격</label>
          <select id={field('minutes')} value={draft.everyMinutes} disabled={disabled}
            onChange={(event) => update({ everyMinutes: Number(event.target.value) })}>
            {MINUTE_STEPS.map((step) => <option key={step} value={step}>{step}분마다</option>)}
          </select>
        </div>
      )}
      {draft.repeat === 'hours' && (
        <div className="ax-schedule-input-row">
          <label htmlFor={field('hours')}>간격</label>
          <select id={field('hours')} value={draft.everyHours} disabled={disabled}
            onChange={(event) => update({ everyHours: Number(event.target.value) })}>
            {HOUR_STEPS.map((step) => <option key={step} value={step}>{step === 1 ? '매시간' : `${step}시간마다`}</option>)}
          </select>
        </div>
      )}

      {(draft.repeat === 'weekly' || draft.repeat === 'biweekly') && (
        <fieldset className="ax-schedule-input-weekdays" disabled={disabled}>
          <legend>요일 (여러 개 선택 가능)</legend>
          {WEEKDAY_OPTIONS.map((option) => (
            <label key={option.value}>
              <input type="checkbox" checked={draft.weekdays.includes(option.value)} onChange={() => toggleWeekday(option.value)} />
              {option.label}
            </label>
          ))}
        </fieldset>
      )}

      {draft.repeat === 'monthly' && (
        <fieldset className="ax-schedule-input-monthly" disabled={disabled}>
          <legend>매월 언제</legend>
          {([
            ['day', '날짜로'],
            ['nth', '몇째 주 무슨 요일'],
            ['last', '마지막 날'],
          ] as Array<[MonthlyMode, string]>).map(([mode, label]) => (
            <label key={mode}>
              <input type="radio" name={field('monthly-mode')} checked={draft.monthlyMode === mode}
                onChange={() => update({ monthlyMode: mode })} />
              {label}
            </label>
          ))}
          {draft.monthlyMode === 'day' && (
            <select aria-label="날짜" value={draft.monthDay} onChange={(event) => update({ monthDay: Number(event.target.value) })}>
              {DAYS.map((day) => <option key={day} value={day}>{day}일</option>)}
            </select>
          )}
          {draft.monthlyMode === 'nth' && (
            <>
              <select aria-label="몇째 주" value={draft.nth} onChange={(event) => update({ nth: Number(event.target.value) })}>
                {NTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select aria-label="요일" value={draft.nthWeekday} onChange={(event) => update({ nthWeekday: event.target.value as WeekdayCode })}>
                {WEEKDAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}요일</option>)}
              </select>
            </>
          )}
        </fieldset>
      )}

      {draft.repeat === 'yearly' && (
        <div className="ax-schedule-input-row">
          <label htmlFor={field('month')}>날짜</label>
          <select id={field('month')} value={draft.month} disabled={disabled} onChange={(event) => update({ month: Number(event.target.value) })}>
            {MONTHS.map((month) => <option key={month} value={month}>{month}월</option>)}
          </select>
          <select aria-label="일" value={draft.monthDay} disabled={disabled} onChange={(event) => update({ monthDay: Number(event.target.value) })}>
            {DAYS.map((day) => <option key={day} value={day}>{day}일</option>)}
          </select>
        </div>
      )}

      {usesTimes && (
        <fieldset className="ax-schedule-input-times" disabled={disabled}>
          <legend>실행 시각 (여러 개 가능)</legend>
          {draft.times.map((time, index) => (
            <div key={index} className="ax-schedule-input-time">
              <input type="time" aria-label={`실행 시각 ${index + 1}`} value={time}
                onChange={(event) => update({ times: draft.times.map((entry, at) => (at === index ? event.target.value : entry)) })} />
              {draft.times.length > 1 && (
                <button type="button" aria-label={`실행 시각 ${index + 1} 삭제`}
                  onClick={() => update({ times: draft.times.filter((_, at) => at !== index) })}>
                  삭제
                </button>
              )}
            </div>
          ))}
          {draft.times.length < 6 && (
            <button type="button" onClick={() => update({ times: [...draft.times, '18:00'] })}>시각 추가</button>
          )}
        </fieldset>
      )}

      <div className="ax-schedule-input-row">
        <label htmlFor={field('start')}>시작일</label>
        <input id={field('start')} type="date" value={draft.startDate} disabled={disabled}
          onChange={(event) => update({ startDate: event.target.value })} />
      </div>
      <div className="ax-schedule-input-row">
        <label htmlFor={field('holidays')}>공휴일</label>
        <input id={field('holidays')} type="checkbox" checked={draft.skipHolidays} disabled={disabled}
          aria-describedby={field('holidays-hint')}
          onChange={(event) => update({ skipHolidays: event.target.checked })} />
        <span id={field('holidays-hint')} className="ax-schedule-input-hint">공휴일에는 건너뛰기 (선거일·임시공휴일은 따로 발표되어 포함되지 않아요)</span>
      </div>
      <div className="ax-schedule-input-row">
        <label htmlFor={field('zone')}>시간대</label>
        <select id={field('zone')} value={draft.timezone} disabled={disabled} onChange={(event) => update({ timezone: event.target.value })}>
          {timeZoneOptions(computerZone).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div className="ax-schedule-input-preview" role="status" aria-live="polite">
        {result.ok ? (
          <>
            <strong>{result.description}</strong>
            <span>다음 실행</span>
            <ul>{result.preview.map((run) => <li key={run}>{run}</li>)}</ul>
          </>
        ) : (
          <span className="ax-schedule-input-error">{result.message}</span>
        )}
      </div>
    </div>
  );
}

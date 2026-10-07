import { useId, useState } from 'react';
import { ScheduleInputFields } from './workspace-assistant-presentation/schedule-input';
import { defaultScheduleDraft } from './workspace-assistant-presentation/schedule-form-model';

/**
 * The last step of a learned work: run it when asked, or on a schedule picked in plain words.
 * Learned works mostly make periodic reports, so the schedule is offered here instead of
 * leaving the person to find a separate place to add it after saving.
 */
export function DiscoveryHandOver({
  busy,
  published,
  onPublish,
}: {
  busy: boolean;
  published: boolean;
  onPublish: (schedule?: string) => Promise<void> | void;
}) {
  const [repeat, setRepeat] = useState(false);
  const [schedule, setSchedule] = useState('');
  const headingId = useId();
  const name = useId();

  if (published) {
    return <span className="connection-badge connected" role="status">업무로 저장됨</span>;
  }

  return (
    <section className="ax-discovery-handover" aria-labelledby={headingId}>
      <p id={headingId} className="ax-discovery-handover-title">언제 할까요?</p>
      <div className="ax-discovery-handover-choices" role="radiogroup" aria-labelledby={headingId}>
        <label>
          <input type="radio" name={name} checked={!repeat} disabled={busy} onChange={() => setRepeat(false)} />
          필요할 때 직접 실행
        </label>
        <label>
          <input type="radio" name={name} checked={repeat} disabled={busy} onChange={() => setRepeat(true)} />
          정해진 때에 반복
        </label>
      </div>
      {repeat && (
        <ScheduleInputFields
          disabled={busy}
          labelledBy={headingId}
          initialDraft={{ ...defaultScheduleDraft(), repeat: 'monthly' }}
          onChange={setSchedule}
        />
      )}
      <button type="button" className="btn btn-primary" disabled={busy || (repeat && !schedule)}
        onClick={() => void onPublish(repeat ? schedule : undefined)}>
        {repeat ? '이 일정으로 맡기기' : '이대로 맡기기'}
      </button>
    </section>
  );
}

import { useId, useState } from 'react';
import { ScheduleInputFields } from './workspace-assistant-presentation/schedule-input';
import { defaultScheduleDraft } from './workspace-assistant-presentation/schedule-form-model';

/**
 * Under a finished one-off result: "do this again on a schedule". Opens the plain-language
 * schedule picker (monthly by default) and asks the host for a job draft built from the steps
 * that just ran. The draft arrives as an ordinary confirmation card; nothing is saved here.
 */
export function MakeRecurringOffer({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (scheduleValue: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const headingId = useId();

  if (!open) {
    return (
      <div className="ax-make-recurring">
        <button type="button" className="ax-workspace-generated-pdf-button" disabled={busy} onClick={() => setOpen(true)}>
          이걸 반복 업무로 만들기
        </button>
        <span className="ax-make-recurring-hint">매달·매주처럼 정해진 때에 같은 작업을 다시 합니다.</span>
      </div>
    );
  }

  const submit = async () => {
    if (!value || busy || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(value);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ax-make-recurring ax-make-recurring--open" aria-labelledby={headingId}>
      <p id={headingId} className="ax-make-recurring-title">언제 반복할까요?</p>
      <ScheduleInputFields
        disabled={busy || submitting}
        labelledBy={headingId}
        initialDraft={{ ...defaultScheduleDraft(), repeat: 'monthly' }}
        onChange={setValue}
      />
      <p className="ax-make-recurring-hint">방금 결과를 만든 방법을 그대로 씁니다. 저장하기 전에 확인 화면이 한 번 더 나옵니다.</p>
      <div className="ax-make-recurring-actions">
        <button type="button" className="ax-workspace-generated-pdf-button ax-workspace-generated-pdf-button--primary" disabled={!value || busy || submitting} onClick={() => void submit()}>
          {submitting ? '초안 만드는 중…' : '업무 초안 만들기'}
        </button>
        <button type="button" className="ax-workspace-generated-pdf-button" disabled={submitting} onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </section>
  );
}

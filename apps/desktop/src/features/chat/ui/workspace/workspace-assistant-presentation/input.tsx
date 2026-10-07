import type { AxInputRequest, AxInputRequestOption } from '@ax-studio/core';
import { ScheduleInputFields } from './schedule-input.js';

export function InputRequestCard({
  request,
  busy,
  value,
  onChange,
  onClear,
  showSubmit = true,
  onSend,
}: {
  request: AxInputRequest;
  busy: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  showSubmit?: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const submit = () => {
    const normalized = value.trim();
    if ((!normalized && request.required) || busy) return;
    void onSend(`${request.label}: ${normalized}`);
    onClear();
  };
  const options = request.options ?? [];
  const selectedOption = options.find((option) => option.value === value);
  const inputId = `ax-input-${request.id}`;
  const reasonId = request.reason ? `${inputId}-reason` : undefined;

  return (
    <div className="ax-workspace-presentation-input" data-testid={`input-request-${request.id}`}>
      <div className="ax-workspace-presentation-input-copy">
        {request.type === 'schedule'
          ? <strong id={inputId}>{request.label}</strong>
          : <label htmlFor={inputId}><strong>{request.label}</strong></label>}
        {request.reason && <span id={reasonId}>{request.reason}</span>}
      </div>
      {request.type === 'schedule' ? (
        <div className="ax-workspace-presentation-input-schedule">
          <ScheduleInputFields disabled={busy} labelledBy={inputId} describedBy={reasonId} onChange={onChange} />
          {showSubmit && (
            <button type="button" disabled={busy || (request.required && !value.trim())} onClick={submit}>
              이 일정으로 계속
            </button>
          )}
        </div>
      ) : (
      <div className="ax-workspace-presentation-input-row">
        {options.length > 0 ? (
          <select
            id={inputId}
            value={value}
            disabled={busy}
            aria-required={request.required}
            aria-describedby={reasonId}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{request.placeholder ?? '선택해 주세요'}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={inputId}
            type={request.type === 'email' ? 'email' : 'text'}
            value={value}
            placeholder={request.placeholder ?? '값을 입력하세요'}
            disabled={busy}
            aria-required={request.required}
            aria-describedby={reasonId}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={showSubmit ? (event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            } : undefined}
          />
        )}
        {showSubmit && (
          <button type="button" disabled={busy || (request.required && !value.trim())} onClick={submit}>
            이 값으로 계속
          </button>
        )}
      </div>
      )}
      {selectedOption?.description && (
        <span className="ax-workspace-presentation-option-description">{selectedOption.description}</span>
      )}
    </div>
  );
}

/** The " (ID: …)" a chosen option carries for the host; people see only the name they picked. */
const OPTION_ID_SUFFIX = / \(ID: [^\n]*\)$/gmu;

export function withoutOptionIds(text: string): string {
  return text.replace(OPTION_ID_SUFFIX, '');
}

export function selectedInputText(request: AxInputRequest, value: string): string {
  const normalized = value.trim();
  const option: AxInputRequestOption | undefined = request.options?.find((entry) => entry.value === normalized);
  return option
    ? `${request.label}: ${option.label} (ID: ${option.value})`
    : `${request.label}: ${normalized}`;
}

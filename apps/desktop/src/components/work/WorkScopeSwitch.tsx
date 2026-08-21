import type { WorkScope } from '@ax-studio/core';

interface WorkScopeSwitchProps {
  value: WorkScope;
  disabled?: boolean;
  onChange: (value: WorkScope) => void;
}

export function WorkScopeSwitch({ value, disabled, onChange }: WorkScopeSwitchProps) {
  return (
    <div
      className={`work-scope-switch ${disabled ? 'disabled' : ''}`}
      role="group"
      aria-label="업무 범위"
    >
      <button
        type="button"
        className={`work-scope-switch-option ${value === 'once' ? 'active' : ''}`}
        aria-pressed={value === 'once'}
        disabled={disabled}
        onClick={() => onChange('once')}
      >
        일회성
      </button>
      <button
        type="button"
        className={`work-scope-switch-option ${value === 'recurring' ? 'active' : ''}`}
        aria-pressed={value === 'recurring'}
        disabled={disabled}
        onClick={() => onChange('recurring')}
      >
        다회성
      </button>
      <span className={`work-scope-switch-thumb ${value === 'recurring' ? 'right' : ''}`} aria-hidden />
    </div>
  );
}

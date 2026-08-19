import type { AiConnectionMode } from '../../../types/ai-provider';

interface AiModeSwitchProps {
  mode: AiConnectionMode;
  cliLabel?: string;
  disabled?: boolean;
  onChange: (mode: AiConnectionMode) => void;
}

export function AiModeSwitch({ mode, cliLabel = 'CLI', disabled, onChange }: AiModeSwitchProps) {
  return (
    <div
      className={`ai-mode-switch ${disabled ? 'disabled' : ''}`}
      role="group"
      aria-label="연결 방식"
    >
      <button
        type="button"
        className={`ai-mode-switch-option ${mode === 'cli' ? 'active' : ''}`}
        aria-pressed={mode === 'cli'}
        disabled={disabled}
        onClick={() => onChange('cli')}
      >
        {cliLabel}
      </button>
      <button
        type="button"
        className={`ai-mode-switch-option ${mode === 'api' ? 'active' : ''}`}
        aria-pressed={mode === 'api'}
        disabled={disabled}
        onClick={() => onChange('api')}
      >
        API
      </button>
      <span className={`ai-mode-switch-thumb ${mode === 'api' ? 'right' : ''}`} aria-hidden />
    </div>
  );
}

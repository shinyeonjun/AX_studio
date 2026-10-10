import type { ReactNode } from 'react';

interface SettingRowProps {
  title: string;
  description?: ReactNode;
  /** The switch or buttons, on the right (below on a narrow window). */
  control: ReactNode;
  children?: ReactNode;
}

/** One setting as a card row: what it does on the left, how to change it on the right. */
export function SettingRow({ title, description, control, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-row-copy">
        <div className="setting-row-title">{title}</div>
        {description && <div className="setting-row-desc">{description}</div>}
        {children}
      </div>
      <div className="setting-row-control">{control}</div>
    </div>
  );
}

interface SettingSwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off switch; underneath it is a real checkbox, so keyboards and screen readers work as usual. */
export function SettingSwitch({ label, checked, disabled, onChange }: SettingSwitchProps) {
  return (
    <label className={`setting-switch${disabled ? ' setting-switch--disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="setting-switch-track" aria-hidden="true"><span className="setting-switch-thumb" /></span>
      <span className="setting-switch-state" aria-hidden="true">{checked ? '켜짐' : '꺼짐'}</span>
    </label>
  );
}

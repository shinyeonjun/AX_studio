import { IconMoon, IconSun } from '../icons';

interface ThemeToggleProps {
  isDark: boolean;
  onToggle: () => void;
}

export function ThemeToggle({ isDark, onToggle }: ThemeToggleProps) {
  return (
    <label className="theme-toggle" title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}>
      <input
        type="checkbox"
        className="theme-toggle-input"
        checked={isDark}
        onChange={onToggle}
        aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      />
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-icon theme-toggle-icon--sun">
          <IconSun />
        </span>
        <span className="theme-toggle-icon theme-toggle-icon--moon">
          <IconMoon />
        </span>
        <span className="theme-toggle-thumb" />
      </span>
    </label>
  );
}

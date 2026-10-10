import { IconMoon, IconSun } from '../icons';

interface ThemeToggleProps {
  isDark: boolean;
  onToggle: () => void;
}

/** A quiet icon button: it shows the mode it switches to, and stays out of the brand's way. */
export function ThemeToggle({ isDark, onToggle }: ThemeToggleProps) {
  const label = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
  return (
    <button type="button" className="theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

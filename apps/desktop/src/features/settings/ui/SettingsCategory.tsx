import type { ReactNode } from 'react';

interface SettingsCategoryProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** Category section on the settings hub — cards only, no inline forms. */
export function SettingsCategory({ title, description, children }: SettingsCategoryProps) {
  return (
    <section className="settings-category">
      <div className="settings-category-header">
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

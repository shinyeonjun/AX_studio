import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  backLabel?: string;
  onBack?: () => void;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, backLabel, onBack, action }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {onBack && backLabel ? (
          <button type="button" className="btn btn-ghost settings-back" onClick={onBack}>
            {backLabel}
          </button>
        ) : null}
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

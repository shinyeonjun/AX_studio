import { CONNECTOR_UI_CATALOG } from '../../../../../ui/constants/connectors';

function GmailBrandIcon() {
  return (
    <svg className="tool-result-brand-icon" viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden="true">
      <path d="M2.25 6.75C2.25 5.507 3.257 4.5 4.5 4.5h1.5l6 4.5 6-4.5h1.5c1.243 0 2.25 1.007 2.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-3v-7.5l-4.5 3.375L7.5 12V19.5h-3A2.25 2.25 0 012.25 17.25V6.75z" fill="#4285F4"/>
      <path d="M19.5 4.5h-1.5v7.5l3.75-2.812V6.75c0-1.243-1.007-2.25-2.25-2.25z" fill="#34A853"/>
      <path d="M6 4.5H4.5C3.257 4.5 2.25 5.507 2.25 6.75v2.438L6 12V4.5z" fill="#EA4335"/>
      <path d="M18 4.5l-6 4.5-6-4.5" stroke="#FBBC05" strokeWidth="0.8"/>
    </svg>
  );
}

function SlackBrandIcon() {
  return (
    <svg className="tool-result-brand-icon" viewBox="0 0 127 127" width="28" height="28" aria-hidden="true">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A"/>
      <path d="M47 27.2c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.7 39.7.8 47 .8c7.3 0 13.2 5.9 13.2 13.2v13.2H47zm0 6.6c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H14C6.7 60.2.8 54.3.8 47c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0"/>
      <path d="M99.8 47c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.8V47zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V14c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33z" fill="#2EB67D"/>
      <path d="M80 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8H80zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80z" fill="#ECB22E"/>
    </svg>
  );
}

export function ToolHeader({ tool, title, badge = '미전송 초안' }: { tool: 'gmail' | 'slack' | 'rdb'; title: string; badge?: string }) {
  const brand = CONNECTOR_UI_CATALOG[tool];
  return (
    <header className="tool-result-header">
      <div className="tool-result-header-main">
        {tool === 'gmail' ? (
          <GmailBrandIcon />
        ) : tool === 'slack' ? (
          <SlackBrandIcon />
        ) : brand.icon ? (
          <img src={brand.icon} alt="" aria-hidden="true" className="tool-result-brand-icon" />
        ) : (
          <span className="tool-result-db-icon" aria-hidden="true">{brand.emoji}</span>
        )}
        <div className="tool-result-header-text">
          <div className="tool-result-title-row">
            <h2>{title}</h2>
            <span className={'tool-result-badge' + (tool === 'rdb' ? ' tool-result-badge--read' : '')}>{badge}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

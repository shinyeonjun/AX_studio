interface AiCliPanelProps {
  label: string;
  description: string;
  connected: boolean;
  badge: string;
  testing: boolean;
  onTest: () => void;
}

export function AiCliPanel({ label, description, connected, badge, testing, onTest }: AiCliPanelProps) {
  return (
    <div className="connection-mode-panel">
      <div className="provider-option selected" style={{ marginBottom: 16 }}>
        <div className="provider-option-header">
          <div className="provider-option-title">{label}</div>
          <span className={`connection-badge ${connected ? 'connected' : ''}`}>{badge}</span>
        </div>
        <div className="provider-option-desc">{description}</div>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onTest} disabled={testing}>
        {testing ? '확인 중...' : 'CLI 연결 테스트'}
      </button>
    </div>
  );
}

import type { AppState } from '../../types/app-state';
import { CONNECTOR_UI_CATALOG, CONNECTOR_UI_IDS } from '../../../constants/connectors';

interface ConnectorHubProps {
  state: AppState | null;
  onOpenAi: () => void;
  onOpenConnector: (screen: 'slack' | 'gmail') => void;
}

export function ConnectorHub({ state, onOpenAi, onOpenConnector }: ConnectorHubProps) {
  return (
    <div className="connection-hub">
      <button type="button" className="connection-card" onClick={onOpenAi}>
        <div className="connection-card-icon ai-icon">AI</div>
        <div className="connection-card-body">
          <div className="connection-card-title">AI 연결</div>
          <div className="connection-card-desc">
            {state?.aiProviderLabel ?? '미선택'} · 인터뷰·분류·판단
          </div>
        </div>
        {state?.aiProviderInstalled ? (
          <span className="connection-badge connected">연결됨</span>
        ) : (
          <span className="connection-badge">미연결</span>
        )}
      </button>

      {CONNECTOR_UI_IDS.map((id) => {
        const meta = CONNECTOR_UI_CATALOG[id];
        const connected = state?.connections?.find((c) => c.connector === id)?.connected;
        return (
          <button
            key={id}
            type="button"
            className="connection-card"
            onClick={() => onOpenConnector(meta.settingsScreen)}
          >
            <img src={meta.icon} alt="" className="connection-card-icon" />
            <div className="connection-card-body">
              <div className="connection-card-title">{meta.title}</div>
              <div className="connection-card-desc">{meta.description}</div>
            </div>
            {connected ? (
              <span className="connection-badge connected">연결됨</span>
            ) : (
              <span className="connection-badge">미연결</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

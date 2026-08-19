import { useState } from 'react';
import slackIcon from '../../../images/connectors/slack.png';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';

interface SlackConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: { token: string; appToken?: string }) => Promise<void>;
}

function slackStatusLabel(state: AppState | null): { badge: string; badgeClass: string; detail: string } {
  const mode = state?.slackConnectionMode ?? 'disconnected';
  if (mode === 'socket') {
    return {
      badge: '연결됨 · 실시간',
      badgeClass: 'connected',
      detail: 'Socket Mode로 메시지를 즉시 받습니다.',
    };
  }
  if (mode === 'poll') {
    return {
      badge: '연결됨 · Poll',
      badgeClass: 'ready',
      detail: state?.slackHasAppToken
        ? 'App Token은 있지만 Socket Mode가 꺼져 있습니다. 앱을 다시 연결해 보세요.'
        : 'Bot Token만 연결됐습니다. 실시간 트리거는 App Token(xapp-)이 필요합니다.',
    };
  }
  return {
    badge: '미연결',
    badgeClass: '',
    detail: 'Bot Token과 Socket Mode용 App Token이 필요합니다.',
  };
}

export function SlackConnectionForm({ state, embedded = false, onConnect }: SlackConnectionFormProps) {
  const [slackToken, setSlackToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const connected = state?.connections?.find((c) => c.connector === 'slack')?.connected;
  const status = slackStatusLabel(state);

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        token: slackToken,
        appToken: appToken.trim() || undefined,
      });
      setMessage('Slack 연결이 완료되었습니다.');
      setSlackToken('');
      setAppToken('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Slack 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'settings-panel' : 'connection-detail'}>
      <div className={`settings-section connection-form ${embedded ? 'connection-form-compact' : ''}`}>
        <div className="connection-form-header">
          <img src={slackIcon} alt="" className="connection-form-icon" />
          <div>
            <h3>Slack 연결</h3>
            <p className="muted">{status.detail}</p>
          </div>
          <span className={`connection-badge ${status.badgeClass}`}>{status.badge}</span>
        </div>

        {connected && (
          <div style={{ marginBottom: 16 }}>
            {state?.slackTeam && <p className="connection-account">워크스페이스: {state.slackTeam}</p>}
            {state?.slackBotUser && <p className="connection-account">봇: @{state.slackBotUser}</p>}
            {state?.slackLastError && (
              <p className="connection-form-message error">Socket Mode: {state.slackLastError}</p>
            )}
          </div>
        )}

        <div className="form-field">
          <label>Bot Token</label>
          <input
            type="password"
            value={slackToken}
            onChange={(e) => setSlackToken(e.target.value)}
            placeholder="xoxb-..."
            disabled={busy}
          />
        </div>
        <div className="form-field">
          <label>App-Level Token (Socket Mode)</label>
          <input
            type="password"
            value={appToken}
            onChange={(e) => setAppToken(e.target.value)}
            placeholder="xapp-..."
            disabled={busy}
          />
        </div>
        <div className="connection-form-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={busy || !slackToken.trim()}
          >
            {busy ? '연결 중...' : connected ? '다시 연결' : '연결하기'}
          </button>
          {message && (
            <p className={`connection-form-message ${message.includes('실패') ? 'error' : ''}`}>
              {message}
            </p>
          )}
        </div>
      </div>
      {!embedded && (
        <ConnectionGuide
          guideKey="slack"
          placeholderName="slack-guide.png"
          steps="Slack 앱 생성 → Socket Mode ON → Bot Token Scopes + App Token(connections:write) → Install → xoxb/xapp 토큰 입력 → Event Subscriptions에서 message 이벤트 구독"
        />
      )}
    </div>
  );
}

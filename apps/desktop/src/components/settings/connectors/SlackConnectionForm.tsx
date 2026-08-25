import { useState } from 'react';
import slackIcon from '../../../images/connectors/slack.png';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';
import { slackCapabilityStatus } from '../../../lib/slack-status';
import { confirmDisconnectConnector } from '../../../lib/confirm-delete';

interface SlackConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: { token: string; appToken?: string }) => Promise<void>;
  onDisconnect?: () => Promise<void>;
}

export function SlackConnectionForm({ state, embedded = false, onConnect, onDisconnect }: SlackConnectionFormProps) {
  const [slackToken, setSlackToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const connected = state?.connections?.find((c) => c.connector === 'slack')?.connected;
  const status = slackCapabilityStatus(state);
  const canSubmit = Boolean(slackToken.trim() || (connected && (appToken.trim() || !status.realtimeTriggers)));

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        token: slackToken,
        appToken: appToken.trim() || undefined,
      });
      setMessage(
        status.realtimeTriggers
          ? 'Slack 연결이 완료되었습니다.'
          : 'Slack 연결을 갱신했습니다. 실시간 트리거 상태를 확인하세요.',
      );
      setSlackToken('');
      setAppToken('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Slack 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;
    if (!confirmDisconnectConnector('Slack')) return;
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('Slack 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Slack 연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const connectLabel = connected
    ? status.realtimeTriggers
      ? '다시 연결'
      : '실시간 트리거 다시 시도'
    : '연결하기';

  return (
    <div className={embedded ? 'settings-panel' : 'connection-detail'}>
      <div className={`settings-section connection-form ${embedded ? 'connection-form-compact' : ''}`}>
        <div className="connection-form-header">
          <img src={slackIcon} alt="" className="connection-form-icon" />
          <div>
            <h3>Slack 연결</h3>
            <p className="muted">{status.headline}</p>
            <p className="muted">{status.detail}</p>
          </div>
          <span className={`connection-badge ${status.badgeClass}`}>{status.badge}</span>
        </div>

        <ul className="connection-capability-list" aria-label="Slack 기능 상태">
          <li>{status.manualSend ? '✓' : '·'} 메시지 발송</li>
          <li>{status.realtimeTriggers ? '✓' : '·'} 실시간 트리거</li>
        </ul>

        {connected && (
          <div style={{ marginBottom: 16 }}>
            {state?.slackTeam && <p className="connection-account">워크스페이스: {state.slackTeam}</p>}
            {state?.slackBotUser && <p className="connection-account">봇: @{state.slackBotUser}</p>}
            {state?.slackLastError && (
              <p className="connection-form-message error" role="alert">
                Socket Mode: {state.slackLastError}
              </p>
            )}
          </div>
        )}

        <div className="form-field">
          <label htmlFor="slack-bot-token">Bot Token</label>
          <input
            id="slack-bot-token"
            type="password"
            value={slackToken}
            onChange={(e) => setSlackToken(e.target.value)}
            placeholder={connected ? '변경할 때만 입력' : 'xoxb-...'}
            disabled={busy}
          />
        </div>
        <div className="form-field">
          <label htmlFor="slack-app-token">App-Level Token (Socket Mode)</label>
          <input
            id="slack-app-token"
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
            onClick={() => void handleConnect()}
            disabled={busy || !canSubmit}
          >
            {busy ? '연결 중...' : connectLabel}
          </button>
          {connected && onDisconnect && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleDisconnect()}
              disabled={busy}
            >
              연결 해제
            </button>
          )}
          {message && (
            <p className={`connection-form-message ${message.includes('실패') ? 'error' : ''}`} role="status">
              {message}
            </p>
          )}
        </div>
      </div>
      {!embedded && (
        <ConnectionGuide
          guideKey="slack"
          placeholderName="slack-guide.png"
          steps={[
            'Slack 앱을 만들고 Socket Mode를 켭니다.',
            'Bot Token Scopes와 App Token(connections:write)을 발급합니다.',
            '앱을 워크스페이스에 설치한 뒤 xoxb / xapp 토큰을 입력합니다.',
            'Event Subscriptions에서 message 이벤트를 구독합니다.',
          ]}
        />
      )}
    </div>
  );
}

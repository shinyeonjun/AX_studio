import slackIcon from '../../../../ui/images/connectors/slack.png';
import { ConnectionGuide } from '../ConnectionGuide';
import { slackCapabilityStatus } from '../../../../ui/lib/slack-status';
import {
  useSlackConnectionForm,
  type SlackConnectionFormProps,
} from './slack-connection/use-slack-connection-form';

export function SlackConnectionForm({ state, embedded = false, onConnect, onDisconnect }: SlackConnectionFormProps) {
  const connected = state?.connections?.find((c) => c.connector === 'slack')?.connected;
  const status = slackCapabilityStatus(state);
  const {
    slackToken,
    setSlackToken,
    appToken,
    setAppToken,
    busy,
    message,
    messageIsError,
    handleConnect,
    handleDisconnect,
  } = useSlackConnectionForm({ onConnect, onDisconnect, realtimeTriggers: status.realtimeTriggers });
  const canSubmit = Boolean(slackToken.trim() || (connected && (appToken.trim() || !status.realtimeTriggers)));

  const connectLabel = connected
    ? status.realtimeTriggers
      ? '다시 연결'
      : '새 메시지 자동 감지 다시 시도'
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
          <li>{status.manualSend ? '✓' : '·'} 메시지 보내기</li>
          <li>{status.realtimeTriggers ? '✓' : '·'} 새 메시지 자동 감지</li>
        </ul>

        {connected && (
          <div style={{ marginBottom: 16 }}>
            {state?.slackTeam && <p className="connection-account">워크스페이스: {state.slackTeam}</p>}
            {state?.slackBotUser && <p className="connection-account">봇: @{state.slackBotUser}</p>}
            {state?.slackLastError && (
              <p className="connection-form-message error" role="alert">
                실시간 수신: {state.slackLastError}
              </p>
            )}
          </div>
        )}

        <div className="form-field">
          <label htmlFor="slack-bot-token">봇 토큰 (xoxb-로 시작)</label>
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
          <label htmlFor="slack-app-token">실시간 수신 토큰 (xapp-로 시작)</label>
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
            {busy ? '연결 중…' : connectLabel}
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
            <p className={`connection-form-message ${messageIsError ? 'error' : ''}`} role="status">
              {message}
            </p>
          )}
        </div>
      </div>
      {!embedded && (
        <ConnectionGuide
          guideKey="slack"
          title="Slack 앱 준비 방법 (관리자용)"
          collapsible
          steps={[
            'api.slack.com에서 Slack 앱을 만들고 Socket Mode를 켭니다.',
            'Bot Token Scopes를 추가하고, connections:write 권한으로 App-Level Token을 발급합니다.',
            '앱을 워크스페이스에 설치한 뒤 봇 토큰(xoxb-)과 실시간 수신 토큰(xapp-)을 위에 입력합니다.',
            'Event Subscriptions에서 message 이벤트를 구독합니다.',
          ]}
        />
      )}
    </div>
  );
}

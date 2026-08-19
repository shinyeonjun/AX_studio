import { useState } from 'react';
import slackIcon from '../../../images/connectors/slack.png';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';

interface SlackConnectionFormProps {
  state: AppState | null;
  onConnect: (token: string) => Promise<void>;
}

export function SlackConnectionForm({ state, onConnect }: SlackConnectionFormProps) {
  const [slackToken, setSlackToken] = useState('');
  const connected = state?.connections?.find((c) => c.connector === 'slack')?.connected;

  return (
    <div className="connection-detail">
      <div className="settings-section connection-form">
        <div className="connection-form-header">
          <img src={slackIcon} alt="" className="connection-form-icon" />
          <div>
            <h3>Slack Bot Token</h3>
            <p className="muted">Slack 앱에서 발급한 xoxb- 토큰을 입력하세요</p>
          </div>
        </div>
        <div className="form-field">
          <label>Bot Token</label>
          <input
            type="password"
            value={slackToken}
            onChange={(e) => setSlackToken(e.target.value)}
            placeholder="xoxb-..."
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={() => onConnect(slackToken)}>
          연결하기
        </button>
        {connected && <p className="connection-success">✓ Slack이 연결되어 있습니다</p>}
      </div>
      <ConnectionGuide
        guideKey="slack"
        placeholderName="slack-guide.png"
        steps="Slack 앱 생성 → Bot Token Scopes 추가 → Install to Workspace → xoxb 토큰 복사"
      />
    </div>
  );
}

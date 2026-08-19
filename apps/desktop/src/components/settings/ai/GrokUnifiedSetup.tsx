import { assessGrokConnection, grokConnectionBadge, grokConnectionGuide } from '../../../lib/ai-connection-status';
import type { DetectedAiCli } from '../../../types/ai-provider';

interface GrokUnifiedSetupProps {
  cliOption?: DetectedAiCli;
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  cliVerified: boolean;
  testing: boolean;
  testingCli: boolean;
  onApiKeyChange: (value: string) => void;
  onTestCli: () => void;
  onTestApiKey: () => void;
}

export function GrokUnifiedSetup({
  cliOption,
  apiKeyDraft,
  apiKeyConfigured,
  apiKeyMasked,
  cliVerified,
  testing,
  testingCli,
  onApiKeyChange,
  onTestCli,
  onTestApiKey,
}: GrokUnifiedSetupProps) {
  const parts = assessGrokConnection(cliOption, apiKeyConfigured, cliVerified);
  const badge = grokConnectionBadge(parts);
  const guide = grokConnectionGuide(parts);

  return (
    <div className="connection-mode-panel">
      <div className="provider-option selected" style={{ marginBottom: 16 }}>
        <div className="provider-option-header">
          <div className="provider-option-title">연결 상태</div>
          <span className={`connection-badge ${badge.connected ? 'connected' : ''}`}>{badge.label}</span>
        </div>
        <div className="provider-option-desc">{guide}</div>
      </div>

      <div className="form-field">
        <label>Cursor API 키</label>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
          .env에 저장되지 않습니다. 이 PC의 OS 자격 증명에 암호화됩니다.
        </p>
        <div className="connection-inline-status">
          <span className={`connection-badge ${parts.apiKeyReady ? 'connected' : ''}`}>
            {parts.apiKeyReady ? '등록됨' : '미등록'}
          </span>
          {apiKeyConfigured && apiKeyMasked && <span className="muted">{apiKeyMasked}</span>}
        </div>
        <input
          type="password"
          placeholder="crsr_..."
          value={apiKeyDraft}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 10 }}
          onClick={onTestApiKey}
          disabled={testing || (!apiKeyDraft.trim() && !apiKeyConfigured)}
        >
          {testing ? '확인 중...' : 'API 키 확인'}
        </button>
      </div>

      <div className="form-field" style={{ marginTop: 20 }}>
        <label>agent CLI</label>
        <div className="connection-inline-status">
          <span className={`connection-badge ${parts.cliFound ? 'connected' : ''}`}>
            {parts.cliFound ? '설치됨' : '미설치'}
          </span>
          {parts.cliPath && <span className="muted">{parts.cliPath}</span>}
          {parts.cliVersion && <span className="muted">· {parts.cliVersion}</span>}
        </div>
        {!parts.cliFound && (
          <p className="muted" style={{ marginTop: 8 }}>
            PowerShell:{' '}
            <code>irm &apos;https://cursor.com/install?win32=true&apos; | iex</code>
          </p>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 10 }}
          onClick={onTestCli}
          disabled={testingCli}
        >
          {testingCli ? '확인 중...' : 'CLI 확인'}
        </button>
      </div>
    </div>
  );
}

export function grokSetupGuide() {
  return (
    <p className="muted">
      Grok는 <strong>Cursor API 키</strong>와 <strong>agent CLI</strong>가 모두 있어야 합니다. 각각
      확인한 뒤 <strong>저장하기</strong>를 누르면 ai.toml에 저장되고 앱에 적용됩니다.
    </p>
  );
}

export function defaultSetupGuide() {
  return (
    <p className="muted">
      연결 테스트가 성공하면 <strong>연결됨</strong>으로 표시됩니다. 확인 후 <strong>저장하기</strong>를
      누르면 ai.toml에 저장되고, 준비가 되면 이 AI가 앱에 적용됩니다.
    </p>
  );
}

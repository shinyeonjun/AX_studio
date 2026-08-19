import { AI_PROVIDER_UI_CATALOG } from '../../../constants/ai-providers';
import type { AiBrand, AiConnectionMode, CliModelOption } from '../../../types/ai-provider';
import type { DetectedAiCli } from '../../../types/ai-provider';
import { defaultSetupGuide } from './AiSetupGuide';
import { AiModeSwitch } from './AiModeSwitch';

interface AiBrandFormProps {
  brand: AiBrand;
  mode: AiConnectionMode;
  model: string;
  models: CliModelOption[];
  cliOption?: DetectedAiCli;
  detecting: boolean;
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  configFilePath?: string;
  cliVerified: boolean;
  apiVerified: boolean;
  saving: boolean;
  testing: boolean;
  testingCli: boolean;
  message: string;
  canSave: boolean;
  isActive: boolean;
  onModeChange: (mode: AiConnectionMode) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onTestCli: () => void;
  onTestApiKey: () => void;
  onSave: () => void;
}

export function AiBrandForm({
  brand,
  mode,
  model,
  models,
  cliOption,
  detecting,
  apiKeyDraft,
  apiKeyConfigured,
  apiKeyMasked,
  configFilePath,
  cliVerified,
  apiVerified,
  saving,
  testing,
  testingCli,
  message,
  canSave,
  isActive,
  onModeChange,
  onModelChange,
  onApiKeyChange,
  onTestCli,
  onTestApiKey,
  onSave,
}: AiBrandFormProps) {
  const meta = AI_PROVIDER_UI_CATALOG[brand];
  const cliConnected = Boolean(cliOption?.installed || cliVerified);
  const apiConnected = Boolean(apiKeyConfigured || apiVerified);

  const cliBadge = cliConnected
    ? cliOption?.installed || cliVerified
      ? '연결됨'
      : 'API 키 필요'
    : '미설치';

  return (
    <div className="connection-detail">
      <div className="settings-section connection-form">
        <div className="connection-form-header">
          <img src={meta.icon} alt="" className="connection-form-icon" />
          <div>
            <h3>{meta.title}</h3>
            <p className="muted">{meta.description}</p>
            {configFilePath && <p className="muted">설정 파일: {configFilePath}</p>}
          </div>
        </div>

        <AiModeSwitch
          mode={mode}
          cliLabel={meta.cliModeLabel === 'Codex' ? 'Codex CLI' : meta.cliLabel}
          onChange={onModeChange}
        />

        {detecting && <p className="muted">연결 상태를 확인하는 중...</p>}

        {mode === 'cli' && (
          <div className="connection-mode-panel">
            <div className="provider-option selected" style={{ marginBottom: 16 }}>
              <div className="provider-option-header">
                <div className="provider-option-title">{meta.cliLabel}</div>
                <span className={`connection-badge ${cliConnected ? 'connected' : ''}`}>{cliBadge}</span>
              </div>
              <div className="provider-option-desc">
                {cliOption?.description ?? `${meta.cliLabel}가 PATH에 있어야 합니다.`}
              </div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={onTestCli} disabled={testingCli}>
              {testingCli ? '확인 중...' : 'CLI 연결 테스트'}
            </button>
          </div>
        )}

        {mode === 'api' && (
          <div className="connection-mode-panel">
            <p className="muted" style={{ marginBottom: 12 }}>
              {`${meta.title} API 키를 등록하세요.`}
            </p>
            <div className="provider-option selected" style={{ marginBottom: 16 }}>
              <div className="provider-option-header">
                <div className="provider-option-title">API 키</div>
                <span className={`connection-badge ${apiConnected ? 'connected' : ''}`}>
                  {apiConnected ? '연결됨' : '미연결'}
                </span>
              </div>
              {apiKeyConfigured && apiKeyMasked && (
                <div className="provider-option-desc">등록된 키: {apiKeyMasked}</div>
              )}
            </div>
            <div className="form-field">
              <label>API 키</label>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKeyDraft}
                onChange={(e) => onApiKeyChange(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onTestApiKey}
                disabled={testing || (!apiKeyDraft.trim() && !apiKeyConfigured)}
              >
                {testing ? '확인 중...' : 'API 연결 테스트'}
              </button>
            </div>
          </div>
        )}

        <div className="form-field" style={{ marginTop: 20 }}>
          <label>모델</label>
          <select
            className="filter-select"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={models.length === 0}
          >
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="connection-form-footer">
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave || saving}>
            {saving ? '저장 중...' : isActive ? '저장하기' : '저장하기'}
          </button>
        </div>

        {message && (
          <p className={`connection-form-message ${message.includes('실패') || message.includes('없') ? 'error' : ''}`}>
            {message}
          </p>
        )}
      </div>

      <div className="connection-guide">
        <h4>연결 팁</h4>
        <div className="guide-placeholder">{defaultSetupGuide()}</div>
      </div>
    </div>
  );
}

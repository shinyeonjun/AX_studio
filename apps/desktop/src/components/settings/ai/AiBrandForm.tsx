import { AI_PROVIDER_UI_CATALOG } from '../../../constants/ai-providers';
import { defaultSetupGuide } from './AiSetupGuide';
import { AiModeSwitch } from './AiModeSwitch';
import { AiApiPanel } from './brand-form/api-panel';
import { AiCliPanel } from './brand-form/cli-panel';
import { AiModelField } from './brand-form/model-field';
import type { AiBrandFormProps } from './brand-form/contracts';

export function AiBrandForm({
  brand,
  embedded = false,
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
  const isOllamaApi = brand === 'ollama' && mode === 'api';
  const cliConnected = Boolean(cliOption?.installed || cliVerified);
  const apiConnected = Boolean(apiKeyConfigured || apiVerified);

  const cliBadge = cliConnected
    ? cliOption?.installed || cliVerified
      ? '연결됨'
      : 'API 키 필요'
    : '미설치';

  return (
    <div className={embedded ? 'connection-form-embedded' : 'connection-detail'}>
      <div className={`settings-section connection-form ${embedded ? 'connection-form-compact' : ''}`}>
        <div className="connection-form-header">
          <img src={meta.icon} alt="" className="connection-form-icon" />
          <div>
            <h3>{meta.title}</h3>
            <p className="muted">{meta.description}</p>
            {!embedded && configFilePath && <p className="muted">설정 파일: {configFilePath}</p>}
          </div>
        </div>

        <AiModeSwitch
          mode={mode}
          cliLabel={meta.cliModeLabel === 'Codex' ? 'Codex CLI' : meta.cliLabel}
          disabled={brand === 'ollama'}
          onChange={onModeChange}
        />

        {detecting && <p className="muted">연결 상태를 확인하는 중...</p>}

        {mode === 'cli' && (
          <AiCliPanel
            label={meta.cliLabel}
            description={cliOption?.description ?? `${meta.cliLabel}가 PATH에 있어야 합니다.`}
            connected={cliConnected}
            badge={cliBadge}
            testing={testingCli}
            onTest={onTestCli}
          />
        )}

        {mode === 'api' && (
          <AiApiPanel
            brand={brand}
            title={meta.title}
            isOllamaApi={isOllamaApi}
            connected={apiConnected}
            apiKeyDraft={apiKeyDraft}
            apiKeyConfigured={apiKeyConfigured}
            apiKeyMasked={apiKeyMasked}
            testing={testing}
            onApiKeyChange={onApiKeyChange}
            onTest={onTestApiKey}
          />
        )}

        <AiModelField brand={brand} model={model} models={models} onChange={onModelChange} />

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

      {!embedded && (
        <div className="connection-guide">
          <h4>연결 팁</h4>
          <div className="guide-placeholder">{defaultSetupGuide()}</div>
        </div>
      )}
    </div>
  );
}

import { AI_PROVIDER_UI_CATALOG } from '../../../../ui/constants/ai-providers';
import { defaultSetupGuide } from './AiSetupGuide';
import { AiCliPanel } from './brand-form/cli-panel';
import { AiModelField } from './brand-form/model-field';
import type { AiBrandFormProps } from './brand-form/contracts';

export function AiBrandForm({
  brand,
  embedded = false,
  model,
  models,
  cliOption,
  detecting,
  cliVerified,
  saving,
  testingCli,
  message,
  messageIsError = false,
  canSave,
  onModelChange,
  onTestCli,
  onSave,
}: AiBrandFormProps) {
  const meta = AI_PROVIDER_UI_CATALOG[brand];
  const cliConnected = Boolean(cliOption?.installed || cliVerified);

  return (
    <div className={embedded ? 'connection-form-embedded' : 'connection-detail'}>
      <div className={`settings-section connection-form ${embedded ? 'connection-form-compact' : ''}`}>
        <div className="connection-form-header">
          <img src={meta.icon} alt="" className="connection-form-icon" />
          <div>
            <h3>{meta.title}</h3>
            <p className="muted">{meta.description}</p>
          </div>
        </div>

        {detecting && <p className="muted">연결 상태를 확인하는 중…</p>}

        <AiCliPanel
          label={meta.cliLabel}
          description={cliOption?.description ?? `이 컴퓨터에 ${meta.cliLabel} 프로그램이 설치되어 있어야 합니다.`}
          connected={cliConnected}
          badge={cliConnected ? '연결됨' : '미설치'}
          testing={testingCli}
          onTest={onTestCli}
        />

        <AiModelField brand={brand} model={model} models={models} onChange={onModelChange} />

        <div className="connection-form-footer">
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave || saving}>
            {saving ? '저장 중…' : '저장하기'}
          </button>
        </div>

        {message && (
          <p className={`connection-form-message ${messageIsError ? 'error' : ''}`} role="status">
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

import type { AiBrand } from '../../../../types/ai-provider';

interface AiApiPanelProps {
  brand: AiBrand;
  title: string;
  isOllamaApi: boolean;
  connected: boolean;
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  testing: boolean;
  onApiKeyChange: (value: string) => void;
  onTest: () => void;
}

export function AiApiPanel({
  brand,
  title,
  isOllamaApi,
  connected,
  apiKeyDraft,
  apiKeyConfigured,
  apiKeyMasked,
  testing,
  onApiKeyChange,
  onTest,
}: AiApiPanelProps) {
  return (
    <div className="connection-mode-panel">
      <p className="muted" style={{ marginBottom: 12 }}>
        {isOllamaApi ? '로컬 Ollama 서버가 실행 중이어야 합니다.' : `${title} API 키를 등록하세요.`}
      </p>
      {!isOllamaApi && (
        <div className="provider-option selected" style={{ marginBottom: 16 }}>
          <div className="provider-option-header">
            <div className="provider-option-title">API 키</div>
            <span className={`connection-badge ${connected ? 'connected' : ''}`}>
              {connected ? '연결됨' : '미연결'}
            </span>
          </div>
          {apiKeyConfigured && apiKeyMasked && <div className="provider-option-desc">등록된 키: {apiKeyMasked}</div>}
        </div>
      )}
      {!isOllamaApi && (
        <div className="form-field">
          <label htmlFor={`${brand}-api-key`}>API 키</label>
          <input
            id={`${brand}-api-key`}
            type="password"
            placeholder="sk-..."
            value={apiKeyDraft}
            onChange={(e) => onApiKeyChange(e.target.value)}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onTest}
          disabled={testing || (!isOllamaApi && !apiKeyDraft.trim() && !apiKeyConfigured)}
        >
          {testing ? '확인 중...' : 'API 연결 테스트'}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';

interface JevDecisionPlaneFormProps {
  onRefresh: () => Promise<void>;
}

export function JevDecisionPlaneForm({ onRefresh }: JevDecisionPlaneFormProps) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('jev-latest');
  const [baseURL, setBaseURL] = useState('https://api.typesafe.ai');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.ax.getJevDecisionConfig()
      .then((config) => {
        if (cancelled) return;
        setEnabled(config.enabled);
        setModel(config.model);
        setBaseURL(config.baseURL);
        setApiKeyConfigured(config.apiKeyConfigured);
        setApiKeyMasked(config.apiKeyMasked);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Jev 설정을 읽지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSave = useMemo(
    () => Boolean(model.trim() && baseURL.trim() && (!enabled || apiKeyConfigured || apiKeyDraft.trim())),
    [model, baseURL, enabled, apiKeyConfigured, apiKeyDraft],
  );

  const testConnection = async () => {
    setTesting(true);
    setMessage('');
    try {
      const draft = apiKeyDraft.trim();
      const result = await window.ax.testJevDecisionApi({
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(draft ? { apiKey: draft } : {}),
      });
      if (result.saved) {
        setApiKeyDraft('');
        setApiKeyConfigured(true);
        setApiKeyMasked(result.masked);
      }
      setMessage(`연결되었습니다. 모델: ${result.model}`);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Jev 연결 테스트에 실패했습니다.');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage('');
    try {
      const draft = apiKeyDraft.trim();
      const config = await window.ax.saveJevDecisionConfig({
        enabled,
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(draft ? { apiKey: draft } : {}),
      });
      setEnabled(config.enabled);
      setModel(config.model);
      setBaseURL(config.baseURL);
      setApiKeyConfigured(config.apiKeyConfigured);
      setApiKeyMasked(config.apiKeyMasked);
      setApiKeyDraft('');
      setMessage(config.enabled
        ? '저장되었습니다. Jev Decision Plane이 즉시 적용되었습니다.'
        : '저장되었습니다. Jev Decision Plane이 꺼져 있습니다.');
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Jev 설정 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="settings-section"><p className="muted">Jev 설정을 불러오는 중...</p></div>;
  }

  const connected = apiKeyConfigured;

  return (
    <div className="settings-scroll">
      <div className="settings-section connection-form">
        <div className="connection-form-header">
          <div className="sidebar-settings-link-icon sidebar-settings-link-icon--emoji" aria-hidden>🧭</div>
          <div>
            <h3>Jev Decision Plane</h3>
            <p className="muted">
              소스 선택, replay ambiguity 판정, 복구 분기 같은 짧은 판단에 Jev를 사용합니다.
            </p>
          </div>
        </div>

        <div className="provider-option selected" style={{ marginBottom: 16 }}>
          <div className="provider-option-header">
            <div>
              <div className="provider-option-title">Decision Plane 사용</div>
              <div className="provider-option-desc">
                실행·replay·publish 검증은 기존 deterministic gate가 계속 최종 권한을 가집니다.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {enabled ? '켜짐' : '꺼짐'}
            </label>
          </div>
        </div>

        <div className="provider-option selected" style={{ marginBottom: 16 }}>
          <div className="provider-option-header">
            <div className="provider-option-title">TypeSafe API</div>
            <span className={`connection-badge ${connected ? 'connected' : ''}`}>
              {connected ? '키 등록됨' : '미연결'}
            </span>
          </div>
          {apiKeyConfigured && apiKeyMasked && (
            <div className="provider-option-desc">등록된 키: {apiKeyMasked}</div>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="jev-api-key">API 키</label>
          <input
            id="jev-api-key"
            type="password"
            placeholder="TypeSafe API key"
            value={apiKeyDraft}
            onChange={(event) => setApiKeyDraft(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="jev-model">모델</label>
          <input
            id="jev-model"
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="jev-latest"
          />
        </div>

        <div className="form-field">
          <label htmlFor="jev-base-url">Base URL</label>
          <input
            id="jev-base-url"
            type="text"
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
            placeholder="https://api.typesafe.ai"
          />
        </div>

        <div className="connection-form-footer" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void testConnection()}
            disabled={testing || (!apiKeyDraft.trim() && !apiKeyConfigured)}
          >
            {testing ? '확인 중...' : 'API 연결 테스트'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={!canSave || saving}
          >
            {saving ? '저장 중...' : '저장하기'}
          </button>
        </div>

        {message && (
          <p className={`connection-form-message ${message.includes('실패') || message.includes('없') ? 'error' : ''}`}>
            {message}
          </p>
        )}
      </div>

      <div className="connection-guide">
        <h4>적용 범위</h4>
        <div className="guide-placeholder">
          Jev는 생성형 답변 대신 짧은 분기 판단에만 사용됩니다. Jev가 실패하거나 확신이 낮으면 기존 규칙 또는 사용자 확인으로 돌아갑니다.
        </div>
      </div>
    </div>
  );
}

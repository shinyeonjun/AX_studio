import { useEffect, useMemo, useState } from 'react';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

interface JevDecisionPlaneFormProps {
  onRefresh: () => Promise<void>;
}

export function JevDecisionPlaneForm({ onRefresh }: JevDecisionPlaneFormProps) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [defaultBaseURL, setDefaultBaseURL] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>();
  const [apiKeyVerified, setApiKeyVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.ax.getJevDecisionConfig()
      .then((config) => {
        if (cancelled) return;
        setEnabled(config.enabled);
        setModel(config.model);
        setBaseURL(config.baseURL);
        setDefaultBaseURL(config.defaultBaseURL);
        setApiKeyConfigured(config.apiKeyConfigured);
        setApiKeyMasked(config.apiKeyMasked);
        setApiKeyVerified(config.apiKeyVerified === true);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(ipcErrorMessage(error, 'Jev 설정을 읽지 못했습니다.'));
          setMessageIsError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSave = useMemo(
    () => Boolean(model.trim() && baseURL.trim() && (!enabled || apiKeyConfigured || apiKeyDraft.length > 0)),
    [model, baseURL, enabled, apiKeyConfigured, apiKeyDraft],
  );

  const testConnection = async () => {
    setTesting(true);
    setApiKeyVerified(false);
    setMessage('');
    setMessageIsError(false);
    try {
      const draft = apiKeyDraft.length > 0 ? apiKeyDraft : undefined;
      const result = await window.ax.testJevDecisionApi({
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(draft === undefined ? {} : { apiKey: draft }),
      });
      if (result.saved) {
        setApiKeyDraft('');
        setApiKeyConfigured(true);
        setApiKeyMasked(result.masked);
      }
      setApiKeyVerified(true);
      setMessage(`연결되었습니다. 모델: ${result.model}`);
      await onRefresh();
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'Jev 연결 테스트에 실패했습니다.'));
      setMessageIsError(true);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage('');
    setMessageIsError(false);
    try {
      const draft = apiKeyDraft.length > 0 ? apiKeyDraft : undefined;
      const config = await window.ax.saveJevDecisionConfig({
        enabled,
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(draft === undefined ? {} : { apiKey: draft }),
      });
      setEnabled(config.enabled);
      setModel(config.model);
      setBaseURL(config.baseURL);
      setApiKeyConfigured(config.apiKeyConfigured);
      setApiKeyMasked(config.apiKeyMasked);
      setApiKeyVerified(config.apiKeyVerified === true);
      setApiKeyDraft('');
      setMessage(config.enabled
        ? '저장했어요. 판단 엔진(Jev)을 바로 사용합니다.'
        : '저장했어요. 판단 엔진(Jev)은 꺼져 있습니다.');
      await onRefresh();
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'Jev 설정 저장에 실패했습니다.'));
      setMessageIsError(true);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="settings-section"><p className="muted">판단 엔진 설정을 불러오는 중…</p></div>;
  }

  return (
    <div className="settings-scroll">
      <div className="settings-section connection-form">
        <div className="connection-form-header">
          <div className="sidebar-settings-link-icon sidebar-settings-link-icon--emoji" aria-hidden>🧭</div>
          <div>
            <h3>판단 엔진(Jev)</h3>
            <p className="muted">
              자료 선택처럼 짧은 결정을 빠르게 내려요. 실제로 실행할지는 항상 앱의 안전 규칙이 정해요.
            </p>
          </div>
        </div>

        <div className="provider-option selected" style={{ marginBottom: 16 }}>
          <div className="provider-option-header">
            <div>
              <div className="provider-option-title">판단 엔진 사용</div>
              <div className="provider-option-desc">
                켜도 실행·저장 여부는 앱의 안전 규칙이 최종으로 정합니다.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                aria-label="판단 엔진 사용"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {enabled ? '켜짐' : '꺼짐'}
            </label>
          </div>
        </div>

        <div className="provider-option selected" style={{ marginBottom: 16 }}>
          <div className="provider-option-header">
            <div className="provider-option-title">판단 엔진 API</div>
            <span className={`connection-badge ${apiKeyVerified ? 'connected' : ''}`}>
              {apiKeyVerified ? '인증 확인됨' : apiKeyConfigured ? '키 등록됨 · 인증 미확인' : '미등록'}
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
            placeholder="판단 엔진 API 키"
            value={apiKeyDraft}
            onChange={(event) => {
              setApiKeyDraft(event.target.value);
              setApiKeyVerified(false);
            }}
          />
        </div>

        <div className="form-field">
          <label htmlFor="jev-model">모델</label>
          <input
            id="jev-model"
            type="text"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setApiKeyVerified(false);
            }}
            placeholder="jev-latest"
          />
        </div>

        <div className="form-field">
          <label htmlFor="jev-base-url">서버 주소</label>
          <input
            id="jev-base-url"
            type="text"
            value={baseURL}
            onChange={(event) => {
              setBaseURL(event.target.value);
              setApiKeyVerified(false);
            }}
            placeholder={defaultBaseURL}
          />
        </div>

        <div className="connection-form-footer" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void testConnection()}
            disabled={testing || (apiKeyDraft.length === 0 && !apiKeyConfigured)}
          >
            {testing ? '확인 중…' : 'API 연결 테스트'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={!canSave || saving}
          >
            {saving ? '저장 중…' : '저장하기'}
          </button>
        </div>

        {message && (
          <p className={`connection-form-message ${messageIsError ? 'error' : ''}`}>
            {message}
          </p>
        )}
      </div>

      <div className="connection-guide">
        <h4>적용 범위</h4>
        <div className="guide-placeholder">
          판단 엔진은 긴 답변을 만들지 않고 짧은 결정에만 쓰여요. 판단 엔진이 실패하거나 확실하지 않으면 기존 규칙을 따르거나 사용자에게 물어봅니다.
        </div>
      </div>
    </div>
  );
}

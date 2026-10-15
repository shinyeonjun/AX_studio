import { useEffect, useState } from 'react';
import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';
import { SettingRow, SettingSwitch } from '../../SettingRow';

interface JevDecisionSwitchProps {
  onRefresh: () => Promise<void>;
  /** `card` matches the connection cards on the settings home; `row` is a full-width setting row. */
  variant?: 'card' | 'row';
  /** Card only: opens the screen where the key is entered (the card is pressed, or switched on without a key). */
  onOpen?: () => void;
}

interface LoadedConfig {
  model: string;
  baseURL: string;
}

/**
 * Jev on or off. On asks only for the API key; the model and the server stay at what is saved
 * (or the defaults). Off leaves the decision to the connected AI.
 */
export function JevDecisionSwitch({ onRefresh, variant = 'row', onOpen }: JevDecisionSwitchProps) {
  const [config, setConfig] = useState<LoadedConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyMasked, setKeyMasked] = useState<string | undefined>();
  const [askingKey, setAskingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.ax.getJevDecisionConfig()
      .then((snapshot) => {
        if (cancelled) return;
        setConfig({ model: snapshot.model, baseURL: snapshot.baseURL || snapshot.defaultBaseURL });
        setEnabled(snapshot.enabled);
        setKeyConfigured(snapshot.apiKeyConfigured);
        setKeyMasked(snapshot.apiKeyMasked);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(ipcErrorMessage(error, '요청 판단 설정을 읽지 못했습니다.'));
        setMessageIsError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const report = (text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
  };

  const save = async (nextEnabled: boolean) => {
    if (!config) return;
    const result = await window.ax.saveJevDecisionConfig({ enabled: nextEnabled, model: config.model, baseURL: config.baseURL });
    setEnabled(result.enabled);
    setKeyConfigured(result.apiKeyConfigured);
    setKeyMasked(result.apiKeyMasked);
    await onRefresh();
  };

  const toggle = async (next: boolean) => {
    report('');
    if (next && !keyConfigured) {
      if (variant === 'card' && onOpen) onOpen();
      else setAskingKey(true);
      return;
    }
    setBusy(true);
    try {
      await save(next);
      setAskingKey(false);
      report(next ? 'Jev가 요청을 판단합니다.' : 'Jev를 껐어요. 연결된 AI가 요청을 판단합니다.');
    } catch (error) {
      report(ipcErrorMessage(error, '요청 판단 설정 저장에 실패했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!config || !keyDraft.trim()) return;
    setBusy(true);
    report('');
    try {
      const tested = await window.ax.testJevDecisionApi({ model: config.model, baseURL: config.baseURL, apiKey: keyDraft.trim() });
      if (tested.saved) {
        setKeyConfigured(true);
        setKeyMasked(tested.masked);
      }
      await save(true);
      setKeyDraft('');
      setAskingKey(false);
      report('연결했어요. Jev가 요청을 판단합니다.');
    } catch (error) {
      report(ipcErrorMessage(error, 'API 키를 확인하지 못했어요. 키를 다시 확인해 주세요.'), true);
    } finally {
      setBusy(false);
    }
  };

  const switchOn = enabled || askingKey;
  const title = 'Jev 요청 판단';
  const description = switchOn
    ? '요청을 보고 무엇을 할지 Jev가 빠르게 정합니다.'
    : '꺼져 있으면 연결된 AI가 요청을 판단합니다.';
  const control = (
    <SettingSwitch
      label={title}
      checked={switchOn}
      disabled={!config || busy}
      onChange={(next) => {
        if (!next && askingKey && !enabled) {
          setAskingKey(false);
          setKeyDraft('');
          report('');
          return;
        }
        void toggle(next);
      }}
    />
  );
  // On the screen itself the key field waits there until a key is saved.
  const showKeyEntry = askingKey || (config !== null && !keyConfigured);
  const details = (
    <>
      {showKeyEntry && (
        <div className="jev-key-entry">
          <input
            type="password"
            aria-label="Jev API 키"
            placeholder="Jev API 키"
            value={keyDraft}
            autoFocus={askingKey}
            onChange={(event) => setKeyDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void connect(); }}
          />
          <button type="button" className="btn btn-primary" disabled={busy || !keyDraft.trim()} onClick={() => void connect()}>
            {busy ? '확인 중…' : '연결'}
          </button>
        </div>
      )}
      {!askingKey && keyConfigured && keyMasked && (
        <div className="jev-key-current">
          등록된 키 {keyMasked}
          <button type="button" className="btn-link" disabled={busy} onClick={() => { setAskingKey(true); report(''); }}>키 바꾸기</button>
        </div>
      )}
      {message && <p className={`connection-form-message ${messageIsError ? 'error' : ''}`}>{message}</p>}
    </>
  );

  if (variant === 'card') {
    return (
      <div
        className="connection-card jev-decision-card"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onOpen?.();
          }
        }}
      >
        <div className="connection-card-icon connection-card-icon-emoji" aria-hidden>🧭</div>
        <div className="connection-card-body">
          <div className="connection-card-title-row">
            <div className="connection-card-title">{title}</div>
            {/* The switch acts on its own; pressing it does not open the screen. */}
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{control}</div>
          </div>
          <div className="connection-card-desc">{description}</div>
          {message && <p className={`connection-form-message ${messageIsError ? 'error' : ''}`}>{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <SettingRow title={title} description={description} control={control}>
      {details}
    </SettingRow>
  );
}

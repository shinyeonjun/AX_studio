import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';
import { confirmDisconnectConnector } from '../../../lib/confirm-delete';

interface OpenApiConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: {
    specId: string;
    label?: string;
    specUrl?: string;
    specJson?: string;
  }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function OpenApiConnectionForm({ state, embedded = false, onConnect, onDisconnect }: OpenApiConnectionFormProps) {
  const connected = Boolean(state?.connections?.find((entry) => entry.connector === 'openapi')?.connected);
  const [specId, setSpecId] = useState('default');
  const [label, setLabel] = useState('');
  const [specUrl, setSpecUrl] = useState('');
  const [specJson, setSpecJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        specId,
        label: label.trim() || undefined,
        specUrl: specUrl.trim() || undefined,
        specJson: specJson.trim() || undefined,
      });
      setMessage('OpenAPI spec이 연결되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OpenAPI 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirmDisconnectConnector('OpenAPI')) return;
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('OpenAPI 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="OpenAPI 연결"
          steps={[
            'spec ID를 지정합니다 (워크플로우 capability prefix로 사용됩니다).',
            'spec URL 또는 JSON 본문 중 하나를 제공합니다.',
            '연결 시 동적 capability가 등록됩니다.',
          ]}
        />
      )}

      <label className="field">
        <span>Spec ID</span>
        <input value={specId} onChange={(event) => setSpecId(event.target.value)} />
      </label>

      <label className="field">
        <span>표시 이름 (선택)</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>

      <label className="field">
        <span>Spec URL</span>
        <input value={specUrl} onChange={(event) => setSpecUrl(event.target.value)} placeholder="https://api.example.com/openapi.json" />
      </label>

      <label className="field">
        <span>또는 Spec JSON</span>
        <textarea value={specJson} onChange={(event) => setSpecJson(event.target.value)} rows={8} placeholder='{"openapi":"3.0.0", ...}' />
      </label>

      <div className="connection-actions">
        <button type="button" className="btn-primary" onClick={() => void handleConnect()} disabled={busy || connected}>
          연결
        </button>
        <button type="button" className="btn-secondary" onClick={() => void handleDisconnect()} disabled={busy || !connected}>
          연결 해제
        </button>
      </div>

      {message && <p className="form-message">{message}</p>}
    </div>
  );
}

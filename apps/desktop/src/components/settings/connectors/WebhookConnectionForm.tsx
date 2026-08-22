import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';

interface WebhookConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: { port: number; secret: string; label?: string; tunnelUrl?: string }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function WebhookConnectionForm({
  state,
  embedded = false,
  onConnect,
  onDisconnect,
}: WebhookConnectionFormProps) {
  const connected = Boolean(state?.connections?.find((entry) => entry.connector === 'webhook')?.connected);
  const [port, setPort] = useState('18789');
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleConnect = async () => {
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort)) {
      setMessage('포트 번호가 올바르지 않습니다.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        port: parsedPort,
        secret,
        label: label.trim() || undefined,
        tunnelUrl: tunnelUrl.trim() || undefined,
      });
      setMessage('Webhook 리스너가 시작되었습니다.');
      setSecret('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Webhook 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('Webhook 리스너가 중지되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const localExample = `http://127.0.0.1:${port || '18789'}/hooks/{path}`;

  return (
    <div className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="Webhook 수신"
          steps={[
            '로컬 포트와 공유 비밀을 설정합니다.',
            '업무 트리거를 webhook.inbound로 저장하고 활성화합니다.',
            '외부에서 접근하려면 ngrok 등 터널 URL을 참고용으로만 적어 둡니다.',
          ]}
        />
      )}

      <div className="connection-form-fields">
        <label htmlFor="webhook-port">로컬 포트</label>
        <input
          id="webhook-port"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          disabled={busy}
        />

        <label htmlFor="webhook-secret">공유 비밀</label>
        <input
          id="webhook-secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="X-AX-Webhook-Secret 헤더 값"
          disabled={busy}
        />

        <label htmlFor="webhook-label">표시 이름 (선택)</label>
        <input
          id="webhook-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />

        <label htmlFor="webhook-tunnel">터널 URL (참고용)</label>
        <input
          id="webhook-tunnel"
          type="url"
          value={tunnelUrl}
          onChange={(e) => setTunnelUrl(e.target.value)}
          placeholder="https://example.ngrok.io"
          disabled={busy}
        />

        <p className="connection-form-hint">
          로컬 URL 예: <code>{localExample}</code>
          <br />
          인증: <code>X-AX-Webhook-Secret</code> 또는 <code>X-AX-Signature: sha256=…</code>
        </p>

        <div className="connection-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleConnect()} disabled={busy}>
            {connected ? '다시 시작' : '리스너 시작'}
          </button>
          {connected && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleDisconnect()} disabled={busy}>
              중지
            </button>
          )}
        </div>

        {message && <p className="connection-form-message">{message}</p>}
      </div>
    </div>
  );
}

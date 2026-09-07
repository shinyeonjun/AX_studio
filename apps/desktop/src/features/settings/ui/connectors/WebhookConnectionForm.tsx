import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';
import {
  useWebhookConnectionForm,
  type WebhookConnectionFormProps,
} from './webhook-connection/use-webhook-connection-form';

export function WebhookConnectionForm({
  state,
  embedded = false,
  onConnect,
  onDisconnect,
}: WebhookConnectionFormProps) {
  const {
    formRef,
    connected,
    port,
    setPort,
    secret,
    setSecret,
    label,
    setLabel,
    tunnelUrl,
    setTunnelUrl,
    busy,
    message,
    lastError,
    connectedItems,
    localExample,
    loadFromConnection,
    handleConnect,
    handleDisconnect,
  } = useWebhookConnectionForm({ state, onConnect, onDisconnect });

  return (
    <div ref={formRef} className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
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
          placeholder={connected ? '변경 시에만 입력' : 'X-AX-Webhook-Secret 헤더 값'}
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

        {(message || (!connected && lastError)) && (
          <p className={`connection-form-message ${!message && lastError ? 'error' : ''}`}>
            {message || lastError}
          </p>
        )}

        <ConnectedServiceList
          title="연결된 Webhook"
          items={connectedItems}
          busy={busy}
          onEdit={() => loadFromConnection()}
          onDisconnect={() => void handleDisconnect()}
        />
      </div>
    </div>
  );
}

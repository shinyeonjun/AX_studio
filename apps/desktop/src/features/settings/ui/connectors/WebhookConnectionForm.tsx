import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';
import {
  useWebhookConnectionForm,
  WEBHOOK_MIN_SECRET_LENGTH,
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
    secretVisible,
    setSecretVisible,
    generateSecret,
    secretError,
    label,
    setLabel,
    tunnelUrl,
    setTunnelUrl,
    busy,
    message,
    messageIsError,
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
          title="외부 신호 받기(Webhook)"
          steps={[
            '신호를 받을 포트 번호와 비밀 키를 정합니다.',
            '업무를 만들 때 시작 조건을 "외부 신호를 받으면"으로 정하고 켭니다.',
            '다른 컴퓨터에서 보내야 한다면 외부 접속 주소를 참고용으로 적어 둡니다.',
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

        <label htmlFor="webhook-secret">비밀 키</label>
        <div className="webhook-secret-row">
          <input
            id="webhook-secret"
            type={secretVisible ? 'text' : 'password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={connected ? '바꿀 때만 입력' : `${WEBHOOK_MIN_SECRET_LENGTH}자 이상`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={secretError ? true : undefined}
            aria-describedby="webhook-secret-hint"
            disabled={busy}
          />
          <button type="button" className="btn btn-secondary" onClick={generateSecret} disabled={busy}>
            무작위 생성
          </button>
          {secret && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSecretVisible(!secretVisible)}
              disabled={busy}
            >
              {secretVisible ? '숨기기' : '보기'}
            </button>
          )}
        </div>
        <p id="webhook-secret-hint" className={`connection-form-hint${secretError ? ' error' : ''}`}>
          {secretError
            ?? `최소 ${WEBHOOK_MIN_SECRET_LENGTH}자 이상이어야 합니다. 무작위 생성으로 만든 값을 보내는 쪽 서비스에도 그대로 입력하세요.`}
        </p>

        <label htmlFor="webhook-label">표시 이름 (선택)</label>
        <input
          id="webhook-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />

        <label htmlFor="webhook-tunnel">외부 접속 주소(참고용)</label>
        <input
          id="webhook-tunnel"
          type="url"
          value={tunnelUrl}
          onChange={(e) => setTunnelUrl(e.target.value)}
          placeholder="https://example.ngrok.io"
          disabled={busy}
        />

        <details className="connection-form-details">
          <summary>개발자용 정보</summary>
          <p className="connection-form-hint">
            받는 주소 예: <code>{localExample}</code>
            <br />
            인증 헤더: <code>X-AX-Webhook-Secret</code> 또는 <code>X-AX-Signature: sha256=…</code>
            <br />
            업무 시작 조건 이름: <code>webhook.inbound</code>
          </p>
        </details>

        <div className="connection-form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleConnect()} disabled={busy}>
            {connected ? '다시 시작' : '받기 시작'}
          </button>
          {connected && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleDisconnect()} disabled={busy}>
              멈추기
            </button>
          )}
        </div>

        {(message || lastError) && (
          <p className={`connection-form-message ${messageIsError || (!message && lastError) ? 'error' : ''}`} role="status">
            {message || lastError}
          </p>
        )}

        <ConnectedServiceList
          title="외부 신호 받기 연결"
          items={connectedItems}
          busy={busy}
          onEdit={() => loadFromConnection()}
          onDisconnect={() => void handleDisconnect()}
        />
      </div>
    </div>
  );
}

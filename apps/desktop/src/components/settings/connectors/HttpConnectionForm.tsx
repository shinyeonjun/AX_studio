import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';
import type { HttpAuthType, HttpConnectionFormProps } from './http-connection/use-http-connection-form';
import { useHttpConnectionForm } from './http-connection/use-http-connection-form';

export function HttpConnectionForm({ state, embedded = false, onConnect, onDisconnect }: HttpConnectionFormProps) {
  const {
    formRef,
    connected,
    endpointId,
    baseUrl,
    setBaseUrl,
    label,
    setLabel,
    authType,
    setAuthType,
    authHeader,
    setAuthHeader,
    username,
    setUsername,
    token,
    setToken,
    password,
    setPassword,
    busy,
    message,
    connectedItems,
    loadFromConnection,
    resetForm,
    handleConnect,
    handleDisconnect,
  } = useHttpConnectionForm({ state, onConnect, onDisconnect });

  return (
    <div ref={formRef} className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="REST API 연결"
          steps={[
            '서비스의 base URL을 입력합니다 (예: https://api.example.com/v1/).',
            'HTTP는 여러 개 연결할 수 있습니다. 업무를 저장할 때 하나를 고릅니다.',
            '필요하면 Bearer, API Key, Basic 인증을 설정합니다.',
            '연결 시 서버 응답을 확인합니다. 요청은 그 연결 주소 밖으로 나가지 않습니다.',
          ]}
        />
      )}

      <div className="connection-form-fields">
        <label htmlFor="http-base-url">Base URL</label>
        <input
          id="http-base-url"
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1/"
          disabled={busy}
        />

        <label htmlFor="http-label">표시 이름 (선택)</label>
        <input
          id="http-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="GitHub"
          disabled={busy}
        />

        <label htmlFor="http-auth-type">인증</label>
        <select
          id="http-auth-type"
          value={authType}
          onChange={(e) => setAuthType(e.target.value as HttpAuthType)}
          disabled={busy}
        >
          <option value="none">없음</option>
          <option value="bearer">Bearer 토큰</option>
          <option value="apiKey">API Key 헤더</option>
          <option value="basic">Basic</option>
        </select>

        {authType === 'apiKey' && (
          <>
            <label htmlFor="http-auth-header">헤더 이름</label>
            <input
              id="http-auth-header"
              type="text"
              value={authHeader}
              onChange={(e) => setAuthHeader(e.target.value)}
              disabled={busy}
            />
          </>
        )}

        {(authType === 'bearer' || authType === 'apiKey') && (
          <>
            <label htmlFor="http-token">토큰</label>
            <input
              id="http-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
            />
          </>
        )}

        {authType === 'basic' && (
          <>
            <label htmlFor="http-username">사용자 이름</label>
            <input
              id="http-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
            <label htmlFor="http-password">비밀번호</label>
            <input
              id="http-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </>
        )}

        <div className="connection-form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleConnect()}
            disabled={busy || !baseUrl.trim()}
          >
            {endpointId ? '저장' : connected ? '추가 연결' : '연결'}
          </button>
          {endpointId && (
            <button type="button" className="btn btn-secondary" onClick={() => resetForm()} disabled={busy}>
              취소
            </button>
          )}
        </div>

        {message && <p className="connection-form-message">{message}</p>}

        <ConnectedServiceList
          title="연결된 HTTP API"
          items={connectedItems}
          busy={busy}
          onEdit={(id) => loadFromConnection(id)}
          onDisconnect={(id) => void handleDisconnect(id)}
        />
      </div>
    </div>
  );
}

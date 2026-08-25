import { useRef, useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { connectionEntry, httpAuthLabel } from '../../../lib/connection-display';
import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';

type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';

interface HttpConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: {
    baseUrl: string;
    label?: string;
    authType: HttpAuthType;
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function HttpConnectionForm({ state, embedded = false, onConnect, onDisconnect }: HttpConnectionFormProps) {
  const httpEntry = connectionEntry(state, 'http');
  const connected = Boolean(httpEntry?.connected);
  const formRef = useRef<HTMLDivElement>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [label, setLabel] = useState('');
  const [authType, setAuthType] = useState<HttpAuthType>('none');
  const [authHeader, setAuthHeader] = useState('X-API-Key');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadFromConnection = () => {
    if (!httpEntry?.connected) return;
    setBaseUrl(httpEntry.baseUrl ?? '');
    setLabel(httpEntry.label ?? '');
    setAuthType(httpEntry.authType ?? 'none');
    if (httpEntry.authHeader) setAuthHeader(httpEntry.authHeader);
    if (httpEntry.username) setUsername(httpEntry.username);
    setToken('');
    setPassword('');
    setMessage('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const connectedItems =
    connected && httpEntry?.baseUrl
      ? [
          {
            id: 'http',
            title: httpEntry.label?.trim() || 'HTTP API',
            subtitle: httpEntry.baseUrl,
            meta: httpAuthLabel(httpEntry.authType, httpEntry.authHeader, httpEntry.username),
          },
        ]
      : [];

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        baseUrl,
        label: label.trim() || undefined,
        authType,
        authHeader: authType === 'apiKey' ? authHeader : undefined,
        username: authType === 'basic' ? username : undefined,
        token: authType === 'bearer' || authType === 'apiKey' ? token : undefined,
        password: authType === 'basic' ? password : undefined,
      });
      setMessage('HTTP API가 연결되었습니다.');
      setToken('');
      setPassword('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'HTTP 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('HTTP 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={formRef} className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="REST API 연결"
          steps={[
            '서비스의 base URL을 입력합니다 (예: https://api.example.com/v1/).',
            '필요하면 Bearer, API Key, Basic 인증을 설정합니다.',
            '연결 시 서버 응답을 확인합니다. 요청은 base URL 밖으로 나가지 않습니다.',
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
          placeholder="내 API"
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
          <button type="button" className="btn btn-primary" onClick={() => void handleConnect()} disabled={busy}>
            {connected ? '다시 연결' : '연결'}
          </button>
          {connected && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleDisconnect()} disabled={busy}>
              연결 해제
            </button>
          )}
        </div>

        {message && <p className="connection-form-message">{message}</p>}

        <ConnectedServiceList
          title="연결된 HTTP API"
          items={connectedItems}
          busy={busy}
          onEdit={() => loadFromConnection()}
          onDisconnect={() => void handleDisconnect()}
        />
      </div>
    </div>
  );
}

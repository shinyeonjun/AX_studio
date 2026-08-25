import { useRef, useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { connectionEntry, httpAuthLabel } from '../../../lib/connection-display';
import { confirmDisconnectConnector } from '../../../lib/confirm-delete';
import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';

type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';

interface HttpConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: {
    endpointId?: string;
    baseUrl: string;
    label?: string;
    authType: HttpAuthType;
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => Promise<void>;
  onDisconnect: (endpointId?: string) => Promise<void>;
}

export function HttpConnectionForm({ state, embedded = false, onConnect, onDisconnect }: HttpConnectionFormProps) {
  const httpEntry = connectionEntry(state, 'http');
  const endpoints = httpEntry?.endpoints?.length
    ? httpEntry.endpoints
    : httpEntry?.connected && httpEntry.baseUrl
      ? [{
          id: 'default',
          baseUrl: httpEntry.baseUrl,
          label: httpEntry.label,
          authType: httpEntry.authType,
          authHeader: httpEntry.authHeader,
          username: httpEntry.username,
        }]
      : [];
  const connected = endpoints.length > 0;
  const formRef = useRef<HTMLDivElement>(null);
  const [endpointId, setEndpointId] = useState<string | undefined>(undefined);
  const [baseUrl, setBaseUrl] = useState('');
  const [label, setLabel] = useState('');
  const [authType, setAuthType] = useState<HttpAuthType>('none');
  const [authHeader, setAuthHeader] = useState('X-API-Key');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadFromConnection = (id: string) => {
    const endpoint = endpoints.find((entry) => entry.id === id);
    if (!endpoint) return;
    setEndpointId(endpoint.id);
    setBaseUrl(endpoint.baseUrl ?? '');
    setLabel(endpoint.label ?? '');
    setAuthType(endpoint.authType ?? 'none');
    setAuthHeader(endpoint.authHeader ?? 'X-API-Key');
    setUsername(endpoint.username ?? '');
    setToken('');
    setPassword('');
    setMessage('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetForm = () => {
    setEndpointId(undefined);
    setBaseUrl('');
    setLabel('');
    setAuthType('none');
    setAuthHeader('X-API-Key');
    setUsername('');
    setToken('');
    setPassword('');
  };

  const connectedItems = endpoints.map((endpoint) => ({
    id: endpoint.id,
    title: endpoint.label?.trim() || 'HTTP API',
    subtitle: endpoint.baseUrl,
    meta: httpAuthLabel(endpoint.authType, endpoint.authHeader, endpoint.username),
  }));

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        endpointId,
        baseUrl,
        label: label.trim() || undefined,
        authType,
        authHeader: authType === 'apiKey' ? authHeader : undefined,
        username: authType === 'basic' ? username : undefined,
        token: authType === 'bearer' || authType === 'apiKey' ? token : undefined,
        password: authType === 'basic' ? password : undefined,
      });
      setMessage(endpointId ? 'HTTP API를 수정했습니다.' : 'HTTP API가 연결되었습니다.');
      resetForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'HTTP 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (id?: string) => {
    const target = id ? endpoints.find((entry) => entry.id === id) : undefined;
    if (!confirmDisconnectConnector(target?.label?.trim() || target?.baseUrl || 'HTTP API')) return;
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect(id);
      setMessage('HTTP 연결이 해제되었습니다.');
      if (!id || id === endpointId) resetForm();
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

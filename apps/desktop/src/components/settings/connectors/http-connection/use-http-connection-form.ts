import { useRef, useState } from 'react';
import type { AppState } from '../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../lib/confirm-delete';
import { httpConnectedItemsFor, httpEndpointsFor } from './model';
import type { HttpAuthType, HttpConnectedItem, HttpEndpoint } from './model';

export type { HttpAuthType, HttpConnectedItem, HttpEndpoint } from './model';

export interface HttpConnectionFormProps {
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

type HttpConnectionControllerProps = Pick<HttpConnectionFormProps, 'state' | 'onConnect' | 'onDisconnect'>;

export function useHttpConnectionForm({
  state,
  onConnect,
  onDisconnect,
}: HttpConnectionControllerProps) {
  const endpoints = httpEndpointsFor(state);
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

  const connectedItems: HttpConnectedItem[] = httpConnectedItemsFor(endpoints);

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

  return {
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
  };
}

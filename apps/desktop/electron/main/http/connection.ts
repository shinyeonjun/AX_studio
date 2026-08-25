import {
  HttpConnector,
  mergeHttpAuthSecret,
  normalizeHttpBaseUrl,
  parseHttpConnectionConfig,
  probeHttpBaseUrl,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../credential-store.js';

const HTTP_SECRET_NAME = 'http.auth';

interface HttpSecret {
  token?: string;
  password?: string;
}

function parseHttpSecret(value: string | null): HttpSecret | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return {
      token: typeof record.token === 'string' ? record.token : undefined,
      password: typeof record.password === 'string' ? record.password : undefined,
    };
  } catch {
    return null;
  }
}

export async function getHttpSecret(): Promise<HttpSecret | null> {
  return parseHttpSecret(await getOsSecret(HTTP_SECRET_NAME));
}

export async function saveHttpSecret(secret: HttpSecret): Promise<void> {
  await setOsSecret(HTTP_SECRET_NAME, JSON.stringify(secret));
}

export async function deleteHttpSecret(): Promise<void> {
  await deleteOsSecret(HTTP_SECRET_NAME);
}

function httpProbeErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'connection_timeout':
      return '서버에 연결할 수 없습니다 (시간 초과).';
    case 'redirect_not_allowed':
      return 'Base URL이 다른 주소로 리다이렉트됩니다. 최종 URL을 직접 입력해 주세요.';
    case 'invalid_base_url':
      return 'Base URL 형식이 올바르지 않습니다.';
    case 'unsupported_protocol':
      return 'http 또는 https URL만 지원합니다.';
    case 'empty_base_url':
      return 'Base URL을 입력해 주세요.';
    case 'connection_failed':
      return 'Base URL에 연결할 수 없습니다. 서버 주소와 네트워크를 확인해 주세요.';
    default:
      return error
        ? `Base URL에 연결할 수 없습니다. (${error})`
        : 'Base URL에 연결할 수 없습니다.';
  }
}

export async function hydrateHttpConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  if (!connection?.connected) return;

  const parsed = parseHttpConnectionConfig(connection.config);
  if (!parsed) {
    store.setConnection('http', false);
    return;
  }

  const secret = await getHttpSecret();
  const merged = mergeHttpAuthSecret(parsed, secret);
  if (!merged) {
    store.setConnection('http', false);
    return;
  }

  runtime.setConnector('http', new HttpConnector(merged));
}

export async function validateAndConnectHttp(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: {
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  },
): Promise<void> {
  const normalized = normalizeHttpBaseUrl(payload.baseUrl);
  if (!normalized.ok) {
    throw new Error(httpProbeErrorMessage(normalized.error));
  }
  const baseUrl = normalized.value;

  const authType = payload.authType;
  const auth =
    authType === 'none'
      ? { type: 'none' as const }
      : authType === 'bearer'
        ? { type: 'bearer' as const, token: payload.token?.trim() }
        : authType === 'apiKey'
          ? { type: 'apiKey' as const, token: payload.token?.trim(), header: payload.authHeader?.trim() || 'X-API-Key' }
          : {
              type: 'basic' as const,
              username: payload.username?.trim(),
              password: payload.password?.trim(),
            };

  const existingSecret = await getHttpSecret();
  if (authType === 'bearer' || authType === 'apiKey') {
    if (!auth.token) {
      auth.token = existingSecret?.token?.trim();
    }
    if (!auth.token) throw new Error('인증 토큰을 입력해 주세요.');
  }
  if (authType === 'basic') {
    if (!auth.password) {
      auth.password = existingSecret?.password?.trim();
    }
    if (!auth.username || !auth.password) throw new Error('사용자 이름과 비밀번호를 입력해 주세요.');
  }

  const probe = await probeHttpBaseUrl(baseUrl, authType === 'none' ? undefined : auth);
  if (!probe.ok) {
    throw new Error(httpProbeErrorMessage(probe.error));
  }

  if (authType === 'none') {
    await deleteHttpSecret();
  } else {
    await saveHttpSecret({
      token: authType === 'bearer' || authType === 'apiKey' ? auth.token : undefined,
      password: authType === 'basic' ? auth.password : undefined,
    });
  }

  store.setConnection('http', true, {
    baseUrl,
    label: payload.label?.trim() || undefined,
    authType,
    authHeader: authType === 'apiKey' ? auth.header : undefined,
    username: authType === 'basic' ? auth.username : undefined,
    authStored: authType !== 'none',
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });

  const merged = mergeHttpAuthSecret(parseHttpConnectionConfig(store.getConnections().find((e) => e.connector === 'http')?.config)!, await getHttpSecret());
  if (merged) runtime.setConnector('http', new HttpConnector(merged));
}

export async function disconnectHttp(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  await deleteHttpSecret();
  store.setConnection('http', false);
  runtime.setConnector('http', null);
}

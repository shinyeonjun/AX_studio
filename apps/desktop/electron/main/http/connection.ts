import {
  DEFAULT_HTTP_ENDPOINT_ID,
  HttpConnector,
  mergeHttpEndpointsWithSecrets,
  normalizeHttpBaseUrl,
  parseHttpEndpointSecrets,
  parseHttpEndpoints,
  probeHttpBaseUrl,
  removeHttpEndpoint,
  serializeHttpEndpoints,
  upsertHttpEndpoint,
  type HttpEndpoint,
  type HttpEndpointSecrets,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { randomUUID } from 'node:crypto';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../credential-store.js';

const HTTP_SECRET_NAME = 'http.auth';

async function readHttpSecrets(): Promise<HttpEndpointSecrets> {
  return parseHttpEndpointSecrets(parseJson(await getOsSecret(HTTP_SECRET_NAME)));
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function writeHttpSecrets(secrets: HttpEndpointSecrets): Promise<void> {
  if (Object.keys(secrets).length === 0) {
    await deleteOsSecret(HTTP_SECRET_NAME);
    return;
  }
  await setOsSecret(HTTP_SECRET_NAME, JSON.stringify(secrets));
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

function applyHttpConnector(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  endpoints: HttpEndpoint[],
  secrets: HttpEndpointSecrets,
): void {
  const merged = mergeHttpEndpointsWithSecrets(endpoints, secrets);
  // Persist the full endpoint list (secrets never serialize) so a missing OS
  // secret degrades to "disconnected" instead of silently erasing endpoints.
  const config = endpoints.length > 0 ? serializeHttpEndpoints(endpoints) : undefined;
  if (merged.length === 0) {
    store.setConnection('http', false, config);
    runtime.setConnector('http', null);
    return;
  }
  store.setConnection('http', true, config);
  runtime.setConnector('http', new HttpConnector(merged));
}

export async function hydrateHttpConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  if (!connection?.connected) return;
  const endpoints = parseHttpEndpoints(connection.config);
  if (endpoints.length === 0) {
    store.setConnection('http', false);
    return;
  }
  applyHttpConnector(store, runtime, endpoints, await readHttpSecrets());
}

export async function validateAndConnectHttp(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: {
    endpointId?: string;
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

  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  const existing = parseHttpEndpoints(connection?.config);
  const secrets = await readHttpSecrets();
  const requestedId = payload.endpointId?.trim();
  const matched = requestedId
    ? existing.find((entry) => entry.id === requestedId)
    : existing.find((entry) => entry.baseUrl.replace(/\/$/, '') === baseUrl.replace(/\/$/, ''));
  const endpointId = matched?.id ?? (existing.length === 0 ? DEFAULT_HTTP_ENDPOINT_ID : randomUUID());
  const existingSecret = secrets[endpointId];

  if (authType === 'bearer' || authType === 'apiKey') {
    if (!auth.token) auth.token = existingSecret?.token?.trim();
    if (!auth.token) throw new Error('인증 토큰을 입력해 주세요.');
  }
  if (authType === 'basic') {
    if (!auth.password) auth.password = existingSecret?.password?.trim();
    if (!auth.username || !auth.password) throw new Error('사용자 이름과 비밀번호를 입력해 주세요.');
  }

  const probe = await probeHttpBaseUrl(baseUrl, authType === 'none' ? undefined : auth);
  if (!probe.ok) {
    throw new Error(httpProbeErrorMessage(probe.error));
  }

  const nextSecrets = { ...secrets };
  if (authType === 'none') {
    delete nextSecrets[endpointId];
  } else {
    nextSecrets[endpointId] = {
      token: authType === 'bearer' || authType === 'apiKey' ? auth.token : undefined,
      password: authType === 'basic' ? auth.password : undefined,
    };
  }
  await writeHttpSecrets(nextSecrets);

  const next = upsertHttpEndpoint(connection?.config, {
    id: endpointId,
    baseUrl,
    label: payload.label?.trim() || undefined,
    auth,
    authStored: authType !== 'none',
    connectedAt: new Date().toISOString(),
  });
  applyHttpConnector(store, runtime, next, nextSecrets);
}

export async function disconnectHttp(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  endpointId?: string,
): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  const remaining = endpointId?.trim()
    ? removeHttpEndpoint(connection?.config, endpointId)
    : [];
  const secrets = await readHttpSecrets();
  if (endpointId?.trim()) {
    delete secrets[endpointId.trim()];
  } else {
    for (const key of Object.keys(secrets)) delete secrets[key];
  }
  await writeHttpSecrets(remaining.length === 0 ? {} : secrets);
  applyHttpConnector(store, runtime, remaining, secrets);
}

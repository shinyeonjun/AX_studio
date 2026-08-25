export type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';

export const DEFAULT_HTTP_ENDPOINT_ID = 'default';

export interface HttpAuthConfig {
  type: HttpAuthType;
  token?: string;
  header?: string;
  username?: string;
  password?: string;
}

export interface HttpConnectionConfig {
  id?: string;
  baseUrl: string;
  label?: string;
  auth?: HttpAuthConfig;
  authStored?: boolean;
  connectedAt?: string;
  lastError?: string;
}

export interface HttpEndpoint extends HttpConnectionConfig {
  id: string;
}

export interface HttpConnectionRecord {
  id?: string;
  baseUrl?: string;
  label?: string;
  authType?: HttpAuthType;
  authHeader?: string;
  authStored?: boolean;
  username?: string;
  connectedAt?: string;
  lastError?: string;
  endpoints?: unknown;
}

export interface HttpEndpointSummary {
  id: string;
  baseUrl: string;
  label?: string;
  authType: HttpAuthType;
  authHeader?: string;
  username?: string;
}

export interface HttpConnectionStatus {
  connected: boolean;
  baseUrl?: string;
  label?: string;
  authType: HttpAuthType;
  lastError?: string;
  endpoints: HttpEndpointSummary[];
}

export interface HttpConnectionValidation {
  ok: boolean;
  status?: number;
  error?: string;
}

export type HttpEndpointSecret = { token?: string; password?: string };
export type HttpEndpointSecrets = Record<string, HttpEndpointSecret>;

const SUPPORTED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function isSupportedHttpMethod(method: string): boolean {
  return SUPPORTED_METHODS.has(method.trim().toUpperCase());
}

function parseAuthType(value: unknown): HttpAuthType | null {
  if (value == null || value === 'none' || value === 'bearer' || value === 'apiKey' || value === 'basic') {
    return (value ?? 'none') as HttpAuthType;
  }
  return null;
}

function parseEndpointRecord(value: unknown, fallbackId: string): HttpEndpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as HttpConnectionRecord;
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  if (!baseUrl) return null;
  const authType = parseAuthType(record.authType);
  if (!authType) return null;

  const auth: HttpAuthConfig = { type: authType };
  if (authType === 'apiKey' && typeof record.authHeader === 'string' && record.authHeader.trim()) {
    auth.header = record.authHeader.trim();
  }
  if (authType === 'basic' && typeof record.username === 'string' && record.username.trim()) {
    auth.username = record.username.trim();
  }

  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
  return {
    id,
    baseUrl,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    auth,
    authStored: record.authStored === true,
    connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : undefined,
    lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
  };
}

/** Legacy single-URL config and `{ endpoints: [...] }` both become a list. */
export function parseHttpEndpoints(config: unknown): HttpEndpoint[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const record = config as HttpConnectionRecord;
  if (Array.isArray(record.endpoints) && record.endpoints.length > 0) {
    const parsed = record.endpoints
      .map((entry, index) => parseEndpointRecord(entry, index === 0 ? DEFAULT_HTTP_ENDPOINT_ID : `http-${index + 1}`))
      .filter((entry): entry is HttpEndpoint => entry !== null);
    const seen = new Set<string>();
    return parsed.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }
  const legacy = parseEndpointRecord(record, DEFAULT_HTTP_ENDPOINT_ID);
  return legacy ? [legacy] : [];
}

export function parseHttpConnectionConfig(config: unknown): HttpConnectionConfig | null {
  return parseHttpEndpoints(config)[0] ?? null;
}

export function serializeHttpEndpoints(endpoints: readonly HttpEndpoint[]): Record<string, unknown> {
  return {
    endpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      baseUrl: endpoint.baseUrl,
      label: endpoint.label,
      authType: endpoint.auth?.type ?? 'none',
      authHeader: endpoint.auth?.header,
      username: endpoint.auth?.username,
      authStored: endpoint.authStored === true,
      connectedAt: endpoint.connectedAt,
      lastError: endpoint.lastError,
    })),
  };
}

export function upsertHttpEndpoint(
  config: unknown,
  endpoint: HttpEndpoint,
): HttpEndpoint[] {
  const endpoints = parseHttpEndpoints(config);
  const byId = endpoints.findIndex((entry) => entry.id === endpoint.id);
  const index = byId >= 0 ? byId : endpoints.findIndex((entry) => entry.baseUrl === endpoint.baseUrl);
  if (index >= 0) {
    const current = endpoints[index]!;
    endpoints[index] = { ...current, ...endpoint, id: current.id };
    return endpoints;
  }
  return [...endpoints, endpoint];
}

export function removeHttpEndpoint(config: unknown, endpointId: string): HttpEndpoint[] {
  return parseHttpEndpoints(config).filter((entry) => entry.id !== endpointId.trim());
}

export function mergeHttpAuthSecret(
  config: HttpConnectionConfig,
  secret: HttpEndpointSecret | null,
): HttpConnectionConfig | null {
  if (!secret) return config.auth?.type === 'none' ? config : null;
  const auth: HttpAuthConfig = { ...config.auth, type: config.auth?.type ?? 'none' };
  if (auth.type === 'bearer' || auth.type === 'apiKey') {
    if (!secret.token?.trim()) return null;
    auth.token = secret.token.trim();
  }
  if (auth.type === 'basic') {
    if (!secret.password?.trim()) return null;
    auth.password = secret.password.trim();
  }
  return { ...config, auth };
}

export function parseHttpEndpointSecrets(value: unknown): HttpEndpointSecrets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = Object.entries(record).filter(([, entry]) => entry && typeof entry === 'object' && !Array.isArray(entry));
  if (nested.length > 0) {
    const secrets: HttpEndpointSecrets = {};
    for (const [id, entry] of nested) {
      const secret = entry as Record<string, unknown>;
      secrets[id] = {
        token: typeof secret.token === 'string' ? secret.token : undefined,
        password: typeof secret.password === 'string' ? secret.password : undefined,
      };
    }
    return secrets;
  }
  const token = typeof record.token === 'string' ? record.token : undefined;
  const password = typeof record.password === 'string' ? record.password : undefined;
  if (!token && !password) return {};
  return { [DEFAULT_HTTP_ENDPOINT_ID]: { token, password } };
}

export function secretForHttpEndpoint(secrets: HttpEndpointSecrets, endpointId: string): HttpEndpointSecret | null {
  return secrets[endpointId] ?? (endpointId === DEFAULT_HTTP_ENDPOINT_ID ? secrets[DEFAULT_HTTP_ENDPOINT_ID] ?? null : null);
}

export function mergeHttpEndpointsWithSecrets(
  endpoints: readonly HttpEndpoint[],
  secrets: HttpEndpointSecrets,
): HttpEndpoint[] {
  return endpoints.flatMap((endpoint) => {
    const merged = mergeHttpAuthSecret(endpoint, secretForHttpEndpoint(secrets, endpoint.id));
    return merged ? [{ ...endpoint, ...merged, id: endpoint.id }] : [];
  });
}

function endpointSummary(endpoint: HttpEndpoint): HttpEndpointSummary {
  return {
    id: endpoint.id,
    baseUrl: endpoint.baseUrl,
    label: endpoint.label,
    authType: endpoint.auth?.type ?? 'none',
    authHeader: endpoint.auth?.header,
    username: endpoint.auth?.username,
  };
}

function endpointAuthReady(endpoint: HttpEndpoint): boolean {
  const authType = endpoint.auth?.type ?? 'none';
  return authType === 'none' || endpoint.authStored === true;
}

export function getHttpConnectionStatus(config: unknown, connected: boolean): HttpConnectionStatus {
  const endpoints = parseHttpEndpoints(config);
  const ready = endpoints.filter(endpointAuthReady);
  const first = ready[0] ?? endpoints[0];
  if (!connected || ready.length === 0) {
    return {
      connected: false,
      authType: first?.auth?.type ?? 'none',
      lastError: first?.lastError,
      endpoints: [],
    };
  }

  return {
    connected: true,
    baseUrl: first?.baseUrl,
    label: first?.label,
    authType: first?.auth?.type ?? 'none',
    lastError: first?.lastError,
    endpoints: ready.map(endpointSummary),
  };
}

export function httpEndpointsFromConnections(
  connections: Array<{ connector: string; connected: boolean; config?: unknown }>,
): HttpEndpoint[] {
  const http = connections.find((entry) => entry.connector === 'http' && entry.connected);
  return http ? parseHttpEndpoints(http.config) : [];
}

export function matchHttpEndpoint(
  endpoints: readonly HttpEndpoint[],
  connectionId?: string,
): HttpEndpoint | undefined {
  const needle = connectionId?.trim();
  if (!needle) {
    if (endpoints.length === 1) return endpoints[0];
    return endpoints.find((entry) => entry.id === DEFAULT_HTTP_ENDPOINT_ID) ?? endpoints[0];
  }
  const lowered = needle.toLowerCase();
  return endpoints.find((entry) =>
    entry.id === needle
    || (entry.label && entry.label.toLowerCase() === lowered)
    || entry.baseUrl === needle
    || entry.baseUrl.replace(/\/$/, '') === needle.replace(/\/$/, ''),
  );
}

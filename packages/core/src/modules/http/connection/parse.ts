import {
  DEFAULT_HTTP_ENDPOINT_ID,
  type HttpAuthConfig,
  type HttpConnectionConfig,
  type HttpConnectionRecord,
  type HttpEndpoint,
} from './contracts.js';

const SUPPORTED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function isSupportedHttpMethod(method: string): boolean {
  return SUPPORTED_METHODS.has(method.trim().toUpperCase());
}

function parseAuthType(value: unknown): HttpAuthConfig['type'] | null {
  if (value == null || value === 'none' || value === 'bearer' || value === 'apiKey' || value === 'basic') {
    return (value ?? 'none') as HttpAuthConfig['type'];
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

/** Legacy single-URL config and an endpoints list both become a list. */
export function parseHttpEndpoints(config: unknown): HttpEndpoint[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const record = config as HttpConnectionRecord;
  if (Array.isArray(record.endpoints) && record.endpoints.length > 0) {
    const parsed = record.endpoints
      .map((entry, index) => parseEndpointRecord(
        entry,
        index === 0 ? DEFAULT_HTTP_ENDPOINT_ID : `http-${index + 1}`,
      ))
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

export function upsertHttpEndpoint(config: unknown, endpoint: HttpEndpoint): HttpEndpoint[] {
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

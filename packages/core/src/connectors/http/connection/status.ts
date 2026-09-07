import type {
  HttpConnectionStatus,
  HttpEndpoint,
  HttpEndpointSummary,
} from './contracts.js';
import { DEFAULT_HTTP_ENDPOINT_ID } from './contracts.js';
import { parseHttpEndpoints } from './parse.js';

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
  const exact = endpoints.filter((entry) => entry.id === needle);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
  const lowered = needle.toLowerCase();
  const matches = endpoints.filter((entry) =>
    (entry.label && entry.label.toLowerCase() === lowered)
    || entry.baseUrl === needle
    || entry.baseUrl.replace(/\/$/, '') === needle.replace(/\/$/, ''),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

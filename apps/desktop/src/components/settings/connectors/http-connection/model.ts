import type { AppState } from '../../../../types/app-state';
import { connectionEntry, httpAuthLabel } from '../../../../lib/connection-display';

export type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';

export interface HttpEndpoint {
  id: string;
  baseUrl: string;
  label?: string;
  authType?: HttpAuthType;
  authHeader?: string;
  username?: string;
}

export interface HttpConnectedItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
}

export function httpEndpointsFor(state: AppState | null): HttpEndpoint[] {
  const httpEntry = connectionEntry(state, 'http');
  return httpEntry?.endpoints?.length
    ? httpEntry.endpoints
    : httpEntry?.connected && httpEntry.baseUrl
      ? [
          {
            id: 'default',
            baseUrl: httpEntry.baseUrl,
            label: httpEntry.label,
            authType: httpEntry.authType,
            authHeader: httpEntry.authHeader,
            username: httpEntry.username,
          },
        ]
      : [];
}

export function httpConnectedItemsFor(endpoints: HttpEndpoint[]): HttpConnectedItem[] {
  return endpoints.map((endpoint) => ({
    id: endpoint.id,
    title: endpoint.label?.trim() || 'HTTP API',
    subtitle: endpoint.baseUrl,
    meta: httpAuthLabel(endpoint.authType, endpoint.authHeader, endpoint.username),
  }));
}

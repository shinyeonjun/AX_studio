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

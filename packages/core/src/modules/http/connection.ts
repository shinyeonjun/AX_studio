export type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';

export interface HttpAuthConfig {
  type: HttpAuthType;
  token?: string;
  header?: string;
  username?: string;
  password?: string;
}

export interface HttpConnectionConfig {
  baseUrl: string;
  label?: string;
  auth?: HttpAuthConfig;
  connectedAt?: string;
  lastError?: string;
}

export interface HttpConnectionRecord {
  baseUrl?: string;
  label?: string;
  authType?: HttpAuthType;
  authHeader?: string;
  authStored?: boolean;
  username?: string;
  connectedAt?: string;
  lastError?: string;
}

export interface HttpConnectionStatus {
  connected: boolean;
  baseUrl?: string;
  label?: string;
  authType: HttpAuthType;
  lastError?: string;
}

export interface HttpConnectionValidation {
  ok: boolean;
  status?: number;
  error?: string;
}

const SUPPORTED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function isSupportedHttpMethod(method: string): boolean {
  return SUPPORTED_METHODS.has(method.trim().toUpperCase());
}

export function parseHttpConnectionConfig(config: unknown): HttpConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as HttpConnectionRecord;
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  if (!baseUrl) return null;

  const authType = record.authType ?? 'none';
  if (authType !== 'none' && authType !== 'bearer' && authType !== 'apiKey' && authType !== 'basic') {
    return null;
  }

  const auth: HttpAuthConfig = { type: authType };
  if (authType === 'apiKey' && typeof record.authHeader === 'string' && record.authHeader.trim()) {
    auth.header = record.authHeader.trim();
  }
  if (authType === 'basic' && typeof record.username === 'string' && record.username.trim()) {
    auth.username = record.username.trim();
  }

  return {
    baseUrl,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    auth,
    connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : undefined,
    lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
  };
}

export function mergeHttpAuthSecret(
  config: HttpConnectionConfig,
  secret: { token?: string; password?: string } | null,
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

export function getHttpConnectionStatus(config: unknown, connected: boolean): HttpConnectionStatus {
  const parsed = parseHttpConnectionConfig(config);
  const record = (config && typeof config === 'object' ? config : {}) as HttpConnectionRecord;
  const authType = parsed?.auth?.type ?? record.authType ?? 'none';
  const authReady = authType === 'none' || record.authStored === true;

  if (!connected || !parsed || !authReady) {
    return {
      connected: false,
      authType,
      lastError: record.lastError,
    };
  }

  return {
    connected: true,
    baseUrl: parsed.baseUrl,
    label: parsed.label,
    authType,
    lastError: record.lastError,
  };
}

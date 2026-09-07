import {
  type HttpAuthConfig,
  type HttpConnectionConfig,
  type HttpEndpoint,
  type HttpEndpointSecret,
  type HttpEndpointSecrets,
  DEFAULT_HTTP_ENDPOINT_ID,
} from './contracts.js';

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

import type { HttpAuthConfig } from '../connection.js';

function buildAuthHeaders(auth: HttpAuthConfig | undefined): Record<string, string> {
  if (!auth || auth.type === 'none') return {};
  if (auth.type === 'bearer' && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === 'apiKey' && auth.token) {
    const header = auth.header?.trim() || 'X-API-Key';
    return { [header]: auth.token };
  }
  if (auth.type === 'basic' && auth.username && auth.password) {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

export function mergeHeadersWithAuth(
  headers: Record<string, string> | undefined,
  auth: HttpAuthConfig | undefined,
): Record<string, string> {
  const merged = { ...(headers ?? {}) };
  for (const [authHeader, value] of Object.entries(buildAuthHeaders(auth))) {
    for (const header of Object.keys(merged)) {
      if (header.toLowerCase() === authHeader.toLowerCase()) delete merged[header];
    }
    merged[authHeader] = value;
  }
  return merged;
}

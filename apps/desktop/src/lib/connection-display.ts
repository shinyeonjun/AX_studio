import type { ConnectionEntry, HttpAuthType } from '../types/connection-entry';

export function connectionEntry(state: { connections?: ConnectionEntry[] } | null, connector: string): ConnectionEntry | undefined {
  return state?.connections?.find((entry) => entry.connector === connector);
}

export function httpAuthLabel(authType: HttpAuthType | undefined, authHeader?: string, username?: string): string {
  switch (authType) {
    case 'bearer':
      return 'Bearer 토큰';
    case 'apiKey':
      return authHeader ? `API Key (${authHeader})` : 'API Key';
    case 'basic':
      return username ? `Basic (${username})` : 'Basic';
    default:
      return '인증 없음';
  }
}

export function rdbTypeLabel(type: ConnectionEntry['dbType']): string {
  switch (type) {
    case 'sqlite':
      return 'SQLite';
    case 'postgres':
      return 'PostgreSQL';
    case 'mysql':
      return 'MySQL';
    default:
      return 'DB';
  }
}

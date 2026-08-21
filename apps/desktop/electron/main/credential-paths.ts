import { join } from 'node:path';
import { getDesktopAxDataPaths } from './data-paths.js';

export function getCredentialsDir(): string {
  return getDesktopAxDataPaths().credentials;
}

export function getSecretPath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(getCredentialsDir(), `secret-${safe}.cred`);
}

export function getCredentialPath(connector: string, connectionId: string): string {
  const safeConnector = credentialSegment(connector, 'connector');
  const safeConnectionId = credentialSegment(connectionId, 'connectionId');
  return join(getCredentialsDir(), `${safeConnector}-${safeConnectionId}.cred`);
}

function credentialSegment(value: string, label: string): string {
  const segment = value.trim();
  if (!segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9._-]+$/.test(segment)) {
    throw new Error(`자격 증명 ${label} 값이 올바르지 않습니다.`);
  }
  return segment;
}

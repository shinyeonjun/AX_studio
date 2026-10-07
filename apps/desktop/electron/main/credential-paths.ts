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
    // The label stays out of the message: it names an internal field, not anything a person chose.
    throw Object.assign(new Error('연결 정보를 찾을 수 없어요. 설정에서 다시 연결해 주세요.'), { detail: label });
  }
  return segment;
}

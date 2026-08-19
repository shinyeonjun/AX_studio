import type { CredentialRef } from '../../credentials/types.js';

export const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

export interface GmailConnectionRecord {
  id: string;
  connector: 'gmail';
  account: string;
  scopes: string[];
  connectedAt: string;
  credentialRef: CredentialRef;
}

export function isGmailConnectionRecord(value: unknown): value is GmailConnectionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GmailConnectionRecord>;
  return (
    record.connector === 'gmail' &&
    typeof record.id === 'string' &&
    typeof record.account === 'string' &&
    Array.isArray(record.scopes) &&
    typeof record.connectedAt === 'string' &&
    record.credentialRef?.connector === 'gmail' &&
    typeof record.credentialRef?.connectionId === 'string'
  );
}

export function parseGmailConnectionConfig(config: Record<string, unknown> | undefined): GmailConnectionRecord | null {
  if (!config) return null;
  if (isGmailConnectionRecord(config)) return config;
  return null;
}

/** Legacy flat config before credential store migration. */
export function isLegacyGmailTokenConfig(config: Record<string, unknown>): boolean {
  return typeof config.refreshToken === 'string' || typeof config.accessToken === 'string';
}

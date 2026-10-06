import type { CredentialRef } from '../../persistence/credentials/types.js';

export {
  GMAIL_CAPABILITY_SCOPES,
  GMAIL_OAUTH_SCOPES,
  gmailCapabilityGranted,
  type GmailCapabilityId,
} from './scopes.js';

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
    record.id.trim().length > 0 &&
    typeof record.account === 'string' &&
    Array.isArray(record.scopes) &&
    typeof record.connectedAt === 'string' &&
    record.credentialRef?.connector === 'gmail' &&
    record.credentialRef?.connectionId === record.id
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

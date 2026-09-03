import { randomUUID } from 'node:crypto';
import {
  GMAIL_OAUTH_SCOPES,
  isLegacyGmailTokenConfig,
  parseGmailConnectionConfig,
  type GmailConnectionRecord,
  type WorkflowStore,
} from '@ax-studio/core';
import { getCredentialStore } from '../../credential-store.js';
import { gmailConnection } from './shared.js';

export async function migrateLegacyGmailConnection(store: WorkflowStore): Promise<void> {
  const conn = gmailConnection(store);
  if (!conn?.connected || !conn.config) return;
  if (parseGmailConnectionConfig(conn.config)) return;
  if (!isLegacyGmailTokenConfig(conn.config)) return;

  const legacy = conn.config;
  const refreshToken = typeof legacy.refreshToken === 'string' ? legacy.refreshToken : undefined;
  if (!refreshToken) {
    store.setConnection('gmail', false);
    return;
  }

  const connectionId = randomUUID();
  const credentialRef = { connector: 'gmail' as const, connectionId };
  await getCredentialStore().set(credentialRef, { refreshToken });

  const record: GmailConnectionRecord = {
    id: connectionId,
    connector: 'gmail',
    account: typeof legacy.email === 'string' ? legacy.email : '',
    scopes: [...GMAIL_OAUTH_SCOPES],
    connectedAt: new Date().toISOString(),
    credentialRef,
  };
  store.setConnection('gmail', true, record as unknown as Record<string, unknown>);
}

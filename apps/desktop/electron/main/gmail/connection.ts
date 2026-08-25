import { randomUUID } from 'node:crypto';
import { shell } from 'electron';
import {
  GmailConnector,
  GMAIL_OAUTH_SCOPES,
  buildGmailConnectorConfig,
  connectGmailViaLoopback,
  fetchGmailProfileEmail,
  isLegacyGmailTokenConfig,
  parseGmailConnectionConfig,
  type GmailConnectionRecord,
  type WorkflowStore,
  type WorkflowRuntime,
} from '@ax-studio/core';
import { getCredentialStore } from '../credential-store.js';
import { getGoogleOAuthCredentials } from './oauth.js';

function gmailConnection(store: WorkflowStore) {
  return store.getConnections().find((c) => c.connector === 'gmail');
}

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

export async function hydrateGmailConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  await migrateLegacyGmailConnection(store);

  const conn = gmailConnection(store);
  if (!conn?.connected || !conn.config) return;

  const record = parseGmailConnectionConfig(conn.config);
  if (!record) return;

  const credential = await getCredentialStore().get(record.credentialRef);
  if (!credential) {
    store.setConnection('gmail', false);
    return;
  }

  const { clientId } = getGoogleOAuthCredentials();
  runtime.connectors.gmail = new GmailConnector(
    buildGmailConnectorConfig({
      clientId,
      credential,
      email: record.account || undefined,
    }),
  );
}

export async function connectGmailOAuth(store: WorkflowStore, runtime: WorkflowRuntime) {
  const { clientId } = getGoogleOAuthCredentials();
  const tokens = await connectGmailViaLoopback({
    clientId,
    onAuthUrl: (url) => shell.openExternal(url),
  });

  const connectionId = randomUUID();
  const credentialRef = { connector: 'gmail' as const, connectionId };
  await getCredentialStore().set(credentialRef, { refreshToken: tokens.refreshToken! });

  const runtimeConfig = buildGmailConnectorConfig({
    clientId,
    credential: {
      refreshToken: tokens.refreshToken!,
      accessToken: tokens.accessToken,
      expiryDate: tokens.expiryDate,
    },
  });

  let account = '';
  try {
    account = (await fetchGmailProfileEmail(runtimeConfig)) ?? '';
  } catch {
    // 프로필 조회 실패해도 연결은 유지
  }

  const record: GmailConnectionRecord = {
    id: connectionId,
    connector: 'gmail',
    account,
    scopes: tokens.scopes,
    connectedAt: new Date().toISOString(),
    credentialRef,
  };

  store.setConnection('gmail', true, record as unknown as Record<string, unknown>);
  runtime.connectors.gmail = new GmailConnector({ ...runtimeConfig, email: account || undefined });

  return { ok: true as const, email: account || undefined };
}

export async function disconnectGmailOAuth(store: WorkflowStore, runtime: WorkflowRuntime) {
  const conn = gmailConnection(store);
  const record = parseGmailConnectionConfig(conn?.config);
  if (record) {
    await getCredentialStore().delete(record.credentialRef);
  }
  store.setConnection('gmail', false);
  delete runtime.connectors.gmail;
  return { ok: true as const };
}

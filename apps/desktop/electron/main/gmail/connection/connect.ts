import { randomUUID } from 'node:crypto';
import { shell } from 'electron';
import {
  GmailConnector,
  buildGmailConnectorConfig,
  connectGmailViaLoopback,
  fetchGmailProfileEmail,
  type GmailConnectionRecord,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { getCredentialStore } from '../../credential-store.js';
import { formatGmailOAuthError, getGoogleOAuthCredentials } from '../oauth.js';

export async function connectGmailOAuth(store: WorkflowStore, runtime: WorkflowRuntime) {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  let tokens;
  try {
    tokens = await connectGmailViaLoopback({
      clientId,
      clientSecret,
      onAuthUrl: (url) => shell.openExternal(url),
    });
  } catch (error) {
    throw formatGmailOAuthError(error);
  }

  const connectionId = randomUUID();
  const credentialRef = { connector: 'gmail' as const, connectionId };
  await getCredentialStore().set(credentialRef, { refreshToken: tokens.refreshToken! });

  const runtimeConfig = buildGmailConnectorConfig({
    clientId,
    clientSecret,
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

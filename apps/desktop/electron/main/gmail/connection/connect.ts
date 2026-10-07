import { randomUUID } from 'node:crypto';
import { BrowserWindow, shell } from 'electron';
import {
  GmailConnector,
  buildGmailConnectorConfig,
  connectGmailViaLoopback,
  fetchGmailProfileEmail,
  parseGmailConnectionConfig,
  revokeGmailRefreshToken,
  type GmailConnectionRecord,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { getCredentialStore } from '../../credential-store.js';
import { formatGmailOAuthError, getGoogleOAuthCredentials } from '../oauth.js';
import { gmailConnection } from './shared.js';

/**
 * Remove the credential of a replaced connection. The old refresh token is
 * revoked only when it belongs to a different account: Google revocation drops
 * the whole grant for that account and client, which would also invalidate the
 * token just issued for the same account.
 */
async function retirePreviousGmailCredential(
  previous: GmailConnectionRecord | null,
  next: { connectionId: string; account: string; clientId: string; clientSecret?: string },
): Promise<void> {
  if (!previous || previous.credentialRef.connectionId === next.connectionId) return;
  const store = getCredentialStore();
  try {
    const sameAccount = !previous.account || !next.account
      || previous.account.toLowerCase() === next.account.toLowerCase();
    if (!sameAccount) {
      const old = await store.get(previous.credentialRef);
      if (old?.refreshToken) {
        await revokeGmailRefreshToken({
          clientId: next.clientId,
          clientSecret: next.clientSecret,
          refreshToken: old.refreshToken,
        }).catch((error: unknown) => {
          console.warn('[gmail] failed to revoke the previous refresh token:', error instanceof Error ? error.message : error);
        });
      }
    }
    await store.delete(previous.credentialRef);
  } catch (error) {
    console.warn('[gmail] failed to remove the previous credential:', error instanceof Error ? error.message : error);
  }
}

function bringAppToFront(): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

export async function connectGmailOAuth(store: WorkflowStore, runtime: WorkflowRuntime) {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  const previous = parseGmailConnectionConfig(gmailConnection(store)?.config);
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
  // Sign-in finished in the browser; bring the app back so the person sees the connection finish.
  bringAppToFront();

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
  await retirePreviousGmailCredential(previous, { connectionId, account, clientId, clientSecret });

  return { ok: true as const, email: account || undefined };
}

import {
  GmailConnector,
  buildGmailConnectorConfig,
  parseGmailConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { CREDENTIAL_UNAVAILABLE_ERROR } from '../../connection-errors.js';
import { gmailSignInStatusRecorder } from './sign-in-status.js';
import { getCredentialStore } from '../../credential-store.js';
import { getGoogleOAuthCredentials } from '../oauth.js';
import { gmailConnection } from './shared.js';
import { migrateLegacyGmailConnection } from './legacy.js';

export async function hydrateGmailConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  await migrateLegacyGmailConnection(store);

  const conn = gmailConnection(store);
  if (!conn?.connected || !conn.config) return;

  const record = parseGmailConnectionConfig(conn.config);
  if (!record) return;

  const credential = await getCredentialStore().get(record.credentialRef);
  if (!credential) {
    // Say why it is no longer connected, as the other connections do.
    store.setConnection('gmail', false, { ...conn.config, lastError: CREDENTIAL_UNAVAILABLE_ERROR });
    return;
  }

  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  let latestRefreshToken = credential.refreshToken;
  runtime.setConnector('gmail', new GmailConnector(
    buildGmailConnectorConfig({
      clientId,
      clientSecret,
      credential,
      email: record.account || undefined,
      onTokens: (tokens) => {
        if (tokens.refreshToken) latestRefreshToken = tokens.refreshToken;
        // The access token is kept too, so the first Gmail call after a start needs no refresh.
        return getCredentialStore().set(record.credentialRef, {
          refreshToken: latestRefreshToken,
          ...(tokens.accessToken ? { accessToken: tokens.accessToken } : {}),
          ...(tokens.expiryDate ? { expiryDate: tokens.expiryDate } : {}),
        });
      },
      onSignInStatus: gmailSignInStatusRecorder(store),
    }),
  ));
}

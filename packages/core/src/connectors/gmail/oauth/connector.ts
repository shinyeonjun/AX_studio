import type { GmailConnectorConfig } from '../connector.js';
import type { OAuthCredential } from '../../../persistence/credentials/types.js';

export function buildGmailConnectorConfig(params: {
  clientId: string;
  clientSecret?: string;
  credential: OAuthCredential;
  email?: string;
  onTokens?: GmailConnectorConfig['onTokens'];
  onSignInStatus?: GmailConnectorConfig['onSignInStatus'];
}): GmailConnectorConfig {
  return {
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    refreshToken: params.credential.refreshToken,
    accessToken: params.credential.accessToken,
    expiryDate: params.credential.expiryDate,
    email: params.email,
    onTokens: params.onTokens,
    onSignInStatus: params.onSignInStatus,
  };
}

export async function fetchGmailProfileEmail(config: GmailConnectorConfig): Promise<string | undefined> {
  const { gmail: gmailClient, auth } = await import('@googleapis/gmail');
  const oauth2 = new auth.OAuth2(config.clientId, config.clientSecret);
  oauth2.setCredentials({
    access_token: config.accessToken,
    refresh_token: config.refreshToken,
    expiry_date: config.expiryDate,
  });
  const gmail = gmailClient({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress ?? undefined;
}

/** Revoke a refresh token at Google. Revocation removes the whole grant for that account and client. */
export async function revokeGmailRefreshToken(params: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<void> {
  const { auth } = await import('@googleapis/gmail');
  const oauth2 = new auth.OAuth2(params.clientId, params.clientSecret);
  await oauth2.revokeToken(params.refreshToken);
}

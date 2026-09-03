import { google } from 'googleapis';
import type { GmailConnectorConfig } from '../connector.js';
import type { OAuthCredential } from '../../../credentials/types.js';

export function buildGmailConnectorConfig(params: {
  clientId: string;
  clientSecret?: string;
  credential: OAuthCredential;
  email?: string;
}): GmailConnectorConfig {
  return {
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    refreshToken: params.credential.refreshToken,
    accessToken: params.credential.accessToken,
    expiryDate: params.credential.expiryDate,
    email: params.email,
  };
}

export async function fetchGmailProfileEmail(config: GmailConnectorConfig): Promise<string | undefined> {
  const oauth2 = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauth2.setCredentials({
    access_token: config.accessToken,
    refresh_token: config.refreshToken,
    expiry_date: config.expiryDate,
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress ?? undefined;
}

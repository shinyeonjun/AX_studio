export { GmailConnector, type GmailConnectorConfig } from './connector.js';
export {
  GMAIL_CAPABILITY_SCOPES,
  GMAIL_OAUTH_SCOPES,
  gmailCapabilityGranted,
  type GmailCapabilityId,
  type GmailConnectionRecord,
  isGmailConnectionRecord,
  parseGmailConnectionConfig,
  isLegacyGmailTokenConfig,
} from './connection.js';
export {
  cancelGmailOAuth,
  connectGmailViaLoopback,
  fetchGmailProfileEmail,
  buildGmailConnectorConfig,
  createOAuthState,
  grantedScopes,
  oauthCallbackStateMatches,
  revokeGmailRefreshToken,
  type GmailOAuthOptions,
  type GmailOAuthResult,
} from './oauth.js';

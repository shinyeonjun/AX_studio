export { GmailConnector, type GmailConnectorConfig } from './connector.js';
export {
  GMAIL_OAUTH_SCOPES,
  type GmailConnectionRecord,
  isGmailConnectionRecord,
  parseGmailConnectionConfig,
  isLegacyGmailTokenConfig,
} from './connection.js';
export {
  connectGmailViaLoopback,
  fetchGmailProfileEmail,
  buildGmailConnectorConfig,
  createOAuthState,
  oauthCallbackStateMatches,
  type GmailOAuthOptions,
  type GmailOAuthResult,
} from './oauth.js';

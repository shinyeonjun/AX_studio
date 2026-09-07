export {
  GMAIL_OAUTH_TIMEOUT_MS,
  connectGmailViaLoopback,
  createOAuthState,
  oauthCallbackStateMatches,
} from './oauth/flow.js';
export {
  buildGmailConnectorConfig,
  fetchGmailProfileEmail,
} from './oauth/connector.js';
export type { GmailOAuthOptions, GmailOAuthResult } from './oauth/contracts.js';

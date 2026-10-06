/**
 * Browser-safe Gmail OAuth scope contract (no Node imports; exported as
 * `@ax-studio/core/gmail-scopes` for the renderer).
 *
 * `gmail.compose` covers drafts.create AND messages.send, so a separate `gmail.send`
 * scope is not requested. Grants made before this change still include `gmail.send`
 * and remain valid: they are supersets of the request.
 */
export const GMAIL_SCOPE_PREFIX = 'https://www.googleapis.com/auth/';

export const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
] as const;

export type GmailCapabilityId = 'read' | 'compose' | 'send';

/** Each capability lists every scope (short name) that grants it; UI ticks derive from this. */
export const GMAIL_CAPABILITY_SCOPES: Readonly<Record<GmailCapabilityId, readonly string[]>> = {
  read: ['gmail.readonly', 'gmail.modify'],
  compose: ['gmail.compose', 'gmail.modify'],
  send: ['gmail.send', 'gmail.compose', 'gmail.modify'],
};

/** True when any granted scope (full URL or short name) grants the capability. */
export function gmailCapabilityGranted(grantedScopes: readonly string[], capability: GmailCapabilityId): boolean {
  const short = new Set(grantedScopes.map((scope) => scope.startsWith(GMAIL_SCOPE_PREFIX) ? scope.slice(GMAIL_SCOPE_PREFIX.length) : scope));
  return GMAIL_CAPABILITY_SCOPES[capability].some((scope) => short.has(scope));
}

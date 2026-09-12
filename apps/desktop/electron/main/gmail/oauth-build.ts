declare const __GOOGLE_OAUTH_CLIENT_ID__: string | undefined;
declare const __GOOGLE_OAUTH_CLIENT_SECRET__: string | undefined;

/** Build-time Gmail OAuth client ID (main process only). */
export function builtInGoogleOAuthClientId(): string | undefined {
  try {
    const value = typeof __GOOGLE_OAUTH_CLIENT_ID__ === 'string' ? __GOOGLE_OAUTH_CLIENT_ID__.trim() : '';
    return value || undefined;
  } catch {
    return undefined;
  }
}

/** Installed Desktop OAuth clients cannot keep this app-level value confidential. */
export function builtInGoogleOAuthClientSecret(): string | undefined {
  const value = typeof __GOOGLE_OAUTH_CLIENT_SECRET__ === 'string' ? __GOOGLE_OAUTH_CLIENT_SECRET__.trim() : '';
  return value || undefined;
}

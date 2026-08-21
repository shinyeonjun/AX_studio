declare const __GOOGLE_OAUTH_CLIENT_ID__: string | undefined;

/** Build-time Gmail OAuth client ID (main process only). */
export function builtInGoogleOAuthClientId(): string | undefined {
  try {
    const value = typeof __GOOGLE_OAUTH_CLIENT_ID__ === 'string' ? __GOOGLE_OAUTH_CLIENT_ID__.trim() : '';
    return value || undefined;
  } catch {
    return undefined;
  }
}

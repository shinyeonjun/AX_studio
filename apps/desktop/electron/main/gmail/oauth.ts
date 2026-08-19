export function getGoogleOAuthClientId(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleOAuthClientId());
}

export function getGoogleOAuthCredentials(): { clientId: string; clientSecret?: string } {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) {
    throw new Error(
      'Gmail OAuth가 앱에 설정되지 않았습니다. 개발 빌드에서는 .env에 GOOGLE_OAUTH_CLIENT_ID를 추가하세요.',
    );
  }
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return { clientId, clientSecret: clientSecret || undefined };
}

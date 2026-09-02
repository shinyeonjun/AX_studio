import { builtInGoogleOAuthClientId } from './oauth-build.js';

export function getGoogleOAuthClientId(): string | undefined {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  return builtInGoogleOAuthClientId() ?? (fromEnv || undefined);
}

export function getGoogleOAuthClientSecret(): string | undefined {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return fromEnv || undefined;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleOAuthClientId());
}

export function getGoogleOAuthCredentials(): { clientId: string; clientSecret?: string } {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) {
    throw new Error(
      'Gmail OAuth가 설정되지 않았습니다. 개발 빌드에서는 .env에 GOOGLE_OAUTH_CLIENT_ID를 추가하세요.',
    );
  }
  const clientSecret = getGoogleOAuthClientSecret();
  return clientSecret ? { clientId, clientSecret } : { clientId };
}

export function formatGmailOAuthError(error: unknown): Error {
  const responseData =
    error && typeof error === 'object'
      ? (error as { response?: { data?: unknown } }).response?.data
      : undefined;
  if (
    responseData &&
    typeof responseData === 'object' &&
    (responseData as { error?: unknown }).error === 'invalid_request' &&
    (responseData as { error_description?: unknown }).error_description === 'client_secret is missing.'
  ) {
    return new Error(
      'Google OAuth 클라이언트가 Client Secret을 요구합니다. 개발 빌드에서는 .env에 GOOGLE_OAUTH_CLIENT_SECRET을 추가하고 앱을 다시 시작하세요.',
    );
  }
  return error instanceof Error ? new Error(error.message) : new Error('Gmail OAuth 연결에 실패했습니다.');
}

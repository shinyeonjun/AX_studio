import { builtInGoogleOAuthClientId, builtInGoogleOAuthClientSecret } from './oauth-build.js';
import { googleDesktopClientState } from './oauth-client.js';

export function getGoogleOAuthClientId(): string | undefined {
  const custom = googleDesktopClientState();
  if (custom.error) return undefined;
  if (custom.client) return custom.client.client_id;
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  return builtInGoogleOAuthClientId() ?? (fromEnv || undefined);
}

export function getGoogleOAuthClientSecret(): string | undefined {
  const custom = googleDesktopClientState();
  if (custom.error) return undefined;
  if (custom.client) return custom.client.client_secret;
  if (builtInGoogleOAuthClientId()) return builtInGoogleOAuthClientSecret();
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
      googleDesktopClientState().error ?? 'Gmail OAuth가 설정되지 않았습니다. 설정 → Gmail에서 데스크톱 앱 클라이언트 JSON을 가져와 주세요.',
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
      'Google OAuth 클라이언트가 Client Secret을 요구합니다. 설정 → Gmail에서 client_secret이 포함된 데스크톱 앱 JSON을 다시 가져와 주세요. 개발 환경은 GOOGLE_OAUTH_CLIENT_SECRET도 확인해 주세요.',
    );
  }
  return error instanceof Error ? new Error(error.message) : new Error('Gmail OAuth 연결에 실패했습니다.');
}

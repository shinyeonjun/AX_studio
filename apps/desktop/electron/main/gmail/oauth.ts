import { app } from 'electron';
import { builtInGoogleOAuthClientId, builtInGoogleOAuthClientSecret } from './oauth-build.js';

function getGoogleOAuthClientId(): string | undefined {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  return builtInGoogleOAuthClientId() ?? (fromEnv || undefined);
}

function getGoogleOAuthClientSecret(): string | undefined {
  if (builtInGoogleOAuthClientId()) return builtInGoogleOAuthClientSecret();
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return fromEnv || undefined;
}

const NOT_CONFIGURED = 'Gmail 연결 기능이 이 설치본에 준비되지 않았어요. 관리자에게 문의해 주세요.';

/** People using an installed app get the message; a developer running from source also gets the fix. */
function forInstall(message: string, developerHint: string): string {
  return app?.isPackaged === false ? `${message} (${developerHint})` : message;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleOAuthClientId());
}

export function getGoogleOAuthCredentials(): { clientId: string; clientSecret?: string } {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) {
    throw new Error(forInstall(
      NOT_CONFIGURED,
      '개발 빌드: .env에 GOOGLE_OAUTH_CLIENT_ID를 추가하고 앱을 다시 시작하세요.',
    ));
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
    return new Error(forInstall(
      NOT_CONFIGURED,
      '개발 빌드: Google OAuth 클라이언트가 Client Secret을 요구합니다. .env에 GOOGLE_OAUTH_CLIENT_SECRET을 추가하고 앱을 다시 시작하세요.',
    ));
  }
  return error instanceof Error ? new Error(error.message) : new Error('Gmail에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

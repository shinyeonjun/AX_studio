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
  const known = gmailSignInFailure(error);
  if (known) return new Error(known);
  return error instanceof Error ? new Error(error.message) : new Error('Gmail에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

/** The sign-in outcomes people cause or can fix, each said with what to do next. */
function gmailSignInFailure(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  const responseError = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error;
  if (code === 'oauth_timeout') return 'Google 로그인을 5분 안에 마치지 않아 연결을 멈췄어요. 다시 연결을 눌러 주세요.';
  if (code === 'oauth_cancelled') return '이전 Google 로그인을 취소했어요. 새로 열린 로그인 창에서 계속해 주세요.';
  if (message === 'access_denied') return 'Google 로그인 화면에서 권한을 허용하지 않아 연결하지 않았어요. 다시 연결을 눌러 허용해 주세요.';
  if (responseError === 'invalid_grant' || message === 'invalid_grant') return 'Google 로그인 정보가 만료됐어요. 다시 연결을 눌러 주세요.';
  if (message.startsWith('No refresh token returned')) {
    return 'Google이 계속 쓸 수 있는 권한을 주지 않았어요. Google 계정 설정 > 보안 > 타사 앱 연결에서 AX Studio를 삭제한 뒤 다시 연결해 주세요.';
  }
  if (message === 'No access token returned') return 'Google에서 연결 권한을 받지 못했어요. 다시 연결을 눌러 주세요.';
  return undefined;
}

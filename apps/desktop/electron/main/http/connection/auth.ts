import type { HttpAuthConfig, HttpEndpointSecret } from '@ax-studio/core';

export interface HttpConnectionPayload {
  endpointId?: string;
  baseUrl: string;
  label?: string;
  authType: 'none' | 'bearer' | 'apiKey' | 'basic';
  authHeader?: string;
  username?: string;
  token?: string;
  password?: string;
}

export function buildHttpAuth(
  payload: HttpConnectionPayload,
  existingSecret: HttpEndpointSecret | undefined,
): HttpAuthConfig {
  let reusableSecret = existingSecret;
  try {
    if (reusableSecret?.origin !== new URL(payload.baseUrl).origin) reusableSecret = undefined;
  } catch {
    reusableSecret = undefined;
  }
  const auth: HttpAuthConfig =
    payload.authType === 'none'
      ? { type: 'none' }
      : payload.authType === 'bearer'
        ? { type: 'bearer', token: payload.token?.trim() }
        : payload.authType === 'apiKey'
          ? { type: 'apiKey', token: payload.token?.trim(), header: payload.authHeader?.trim() || 'X-API-Key' }
          : {
              type: 'basic',
              username: payload.username?.trim(),
              password: payload.password?.trim(),
            };

  if (payload.authType === 'bearer' || payload.authType === 'apiKey') {
    if (!auth.token) auth.token = reusableSecret?.token?.trim();
    if (!auth.token) throw new Error('인증 토큰을 입력해 주세요.');
  }
  if (payload.authType === 'basic') {
    if (!auth.password) auth.password = reusableSecret?.password?.trim();
    if (!auth.username || !auth.password) throw new Error('사용자 이름과 비밀번호를 입력해 주세요.');
  }
  return auth;
}

import { describe, expect, it, vi } from 'vitest';
import { connectGmailViaLoopback, createOAuthState, grantedScopes, oauthCallbackStateMatches } from './oauth.js';

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        constructor(
          _clientId: string,
          _clientSecret: string | undefined,
          private readonly redirectUri: string,
        ) {}

        generateAuthUrl(params: { state: string }): string {
          const url = new URL('https://oauth.fixture.invalid/auth');
          url.searchParams.set('redirect_uri', this.redirectUri);
          url.searchParams.set('state', params.state);
          return url.toString();
        }

        async getToken(): Promise<never> {
          throw new Error('Unexpected token exchange in loopback timeout test');
        }
      },
    },
  },
}));

vi.mock('google-auth-library', () => ({
  CodeChallengeMethod: { S256: 'S256' },
}));

describe('Gmail OAuth state', () => {
  it('accepts the original state and rejects missing or mutated values', () => {
    const state = createOAuthState();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(oauthCallbackStateMatches(state, state)).toBe(true);
    expect(oauthCallbackStateMatches(state, null)).toBe(false);
    expect(oauthCallbackStateMatches(state, '')).toBe(false);
    expect(oauthCallbackStateMatches(state, `${state.slice(0, -1)}x`)).toBe(false);
  });

  it('times out and closes the loopback server when authentication is abandoned', async () => {
    let callbackUrl = '';

    await expect(
      connectGmailViaLoopback({
        clientId: 'test-client',
        timeoutMs: 50,
        onAuthUrl: (authUrl) => {
          callbackUrl = new URL(authUrl).searchParams.get('redirect_uri') ?? '';
        },
      }),
    ).rejects.toMatchObject({ code: 'oauth_timeout' });

    expect(callbackUrl).not.toBe('');
    await expect(fetch(callbackUrl)).rejects.toThrow();
  });

  it('answers a forged-state callback with 400 and keeps waiting for the real one', async () => {
    let resolveAuthUrl!: (url: string) => void;
    const authUrlSeen = new Promise<string>((resolve) => { resolveAuthUrl = resolve; });
    const pending = connectGmailViaLoopback({
      clientId: 'test-client',
      timeoutMs: 5_000,
      onAuthUrl: (authUrl) => resolveAuthUrl(authUrl),
    });
    const outcome = pending.then(() => undefined, (error: unknown) => error);
    const authUrl = new URL(await authUrlSeen);
    const callback = new URL(authUrl.searchParams.get('redirect_uri')!);

    callback.searchParams.set('state', 'forged');
    callback.searchParams.set('error', 'access_denied');
    const forged = await fetch(callback);
    expect(forged.status).toBe(400);

    callback.searchParams.set('state', authUrl.searchParams.get('state')!);
    callback.searchParams.set('error', 'user_cancelled');
    await fetch(callback);
    expect(await outcome).toMatchObject({ message: 'user_cancelled' });
  });

  it('records the scopes Google actually granted', () => {
    expect(grantedScopes('a b', ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(grantedScopes(undefined, ['a'])).toEqual(['a']);
    expect(grantedScopes('', ['a'])).toEqual(['a']);
  });
});

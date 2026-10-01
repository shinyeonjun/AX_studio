import { describe, expect, it, vi } from 'vitest';
import { connectGmailViaLoopback, createOAuthState, oauthCallbackStateMatches } from './oauth.js';

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
});

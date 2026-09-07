import { describe, expect, it } from 'vitest';
import { connectGmailViaLoopback, createOAuthState, oauthCallbackStateMatches } from './oauth.js';

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

import { describe, expect, it } from 'vitest';
import { createOAuthState, oauthCallbackStateMatches } from './oauth.js';

describe('Gmail OAuth state', () => {
  it('accepts the original state and rejects missing or mutated values', () => {
    const state = createOAuthState();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(oauthCallbackStateMatches(state, state)).toBe(true);
    expect(oauthCallbackStateMatches(state, null)).toBe(false);
    expect(oauthCallbackStateMatches(state, '')).toBe(false);
    expect(oauthCallbackStateMatches(state, `${state.slice(0, -1)}x`)).toBe(false);
  });
});

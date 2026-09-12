import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatGmailOAuthError, getGoogleOAuthCredentials } from './oauth.js';

const originalClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const originalClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  else process.env.GOOGLE_OAUTH_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  else process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalClientSecret;
});

describe('desktop Gmail OAuth credentials', () => {
  it('loads the installed desktop client pair without a development env file', () => {
    vi.stubGlobal('__GOOGLE_OAUTH_CLIENT_ID__', 'installed-client.apps.googleusercontent.com');
    vi.stubGlobal('__GOOGLE_OAUTH_CLIENT_SECRET__', 'installed-desktop-secret');
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(getGoogleOAuthCredentials()).toEqual({
      clientId: 'installed-client.apps.googleusercontent.com', clientSecret: 'installed-desktop-secret',
    });
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'unrelated-env-secret';
    expect(getGoogleOAuthCredentials().clientSecret).toBe('installed-desktop-secret');
  });

  it('keeps the client secret when building the Core OAuth configuration', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';

    expect(getGoogleOAuthCredentials()).toEqual({
      clientId: 'test-client.apps.googleusercontent.com',
      clientSecret: 'test-client-secret',
    });
  });

  it('turns the missing-secret token response into an actionable, non-secret error', () => {
    const error = formatGmailOAuthError({
      response: {
        data: {
          error: 'invalid_request',
          error_description: 'client_secret is missing.',
        },
      },
    });

    expect(error.message).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
    expect(error.message).not.toContain('test-client-secret');
  });
});

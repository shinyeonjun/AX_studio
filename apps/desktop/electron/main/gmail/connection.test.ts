import { afterEach, describe, expect, it, vi } from 'vitest';

const gmailState = vi.hoisted(() => ({
  credentials: vi.fn(),
  connect: vi.fn(),
  build: vi.fn((value: unknown) => value),
  profile: vi.fn(),
  setCredential: vi.fn(),
  GmailConnector: vi.fn(function (config: unknown) {
    return { config };
  }),
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

vi.mock('@ax-studio/core', () => ({
  GMAIL_OAUTH_SCOPES: ['https://www.googleapis.com/auth/gmail.readonly'],
  GmailConnector: gmailState.GmailConnector,
  buildGmailConnectorConfig: gmailState.build,
  connectGmailViaLoopback: gmailState.connect,
  fetchGmailProfileEmail: gmailState.profile,
  isLegacyGmailTokenConfig: vi.fn(() => false),
  parseGmailConnectionConfig: vi.fn(() => null),
}));

vi.mock('../credential-store.js', () => ({
  getCredentialStore: () => ({ set: gmailState.setCredential }),
}));

vi.mock('./oauth.js', () => ({
  formatGmailOAuthError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  getGoogleOAuthCredentials: gmailState.credentials,
}));

import { connectGmailOAuth } from './connection.js';

describe('desktop Gmail OAuth connection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes the configured client secret to loopback exchange and runtime refresh config', async () => {
    gmailState.credentials.mockReturnValue({
      clientId: 'test-client.apps.googleusercontent.com',
      clientSecret: 'test-client-secret',
    });
    gmailState.connect.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    });
    gmailState.profile.mockResolvedValue('user@example.com');

    const store = {
      getConnections: () => [],
      setConnection: vi.fn(),
    };
    const runtime = { connectors: {} };

    await connectGmailOAuth(store as never, runtime as never);

    expect(gmailState.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'test-client.apps.googleusercontent.com',
        clientSecret: 'test-client-secret',
      }),
    );
    expect(gmailState.build).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'test-client.apps.googleusercontent.com',
        clientSecret: 'test-client-secret',
      }),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const gmailState = vi.hoisted(() => ({
  credentials: vi.fn(),
  connect: vi.fn(),
  build: vi.fn((value: unknown) => value),
  profile: vi.fn(),
  getCredential: vi.fn(),
  setCredential: vi.fn(),
  parseConfig: vi.fn((_: unknown): unknown => null),
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
  parseGmailConnectionConfig: gmailState.parseConfig,
}));

vi.mock('../credential-store.js', () => ({
  getCredentialStore: () => ({ get: gmailState.getCredential, set: gmailState.setCredential }),
}));

vi.mock('./oauth.js', () => ({
  formatGmailOAuthError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  getGoogleOAuthCredentials: gmailState.credentials,
}));

import { connectGmailOAuth } from './connection.js';
import { hydrateGmailConnector } from './connection/hydrate.js';

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

  it('keeps the newest rotated refresh token across later token events', async () => {
    gmailState.credentials.mockReturnValue({ clientId: 'client', clientSecret: 'secret' });
    gmailState.getCredential.mockResolvedValue({ refreshToken: 'initial-refresh' });
    gmailState.parseConfig.mockReturnValue({
      credentialRef: { connector: 'gmail', connectionId: 'gmail-1' },
      account: 'user@example.com',
    });
    const store = {
      getConnections: () => [{ connector: 'gmail', connected: true, config: { connected: true } }],
      setConnection: vi.fn(),
    };
    const runtime = { connectors: {} };

    await hydrateGmailConnector(store as never, runtime as never);
    const config = gmailState.GmailConnector.mock.calls.at(-1)?.[0] as {
      onTokens: (tokens: { refreshToken?: string }) => Promise<void>;
    };
    await config.onTokens({ refreshToken: 'rotated-refresh' });
    await config.onTokens({});

    expect(gmailState.setCredential).toHaveBeenLastCalledWith(
      { connector: 'gmail', connectionId: 'gmail-1' },
      { refreshToken: 'rotated-refresh' },
    );
  });
});

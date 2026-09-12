import { afterEach, expect, it, vi } from 'vitest';

const secrets = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock('../credential-store.js', () => ({ getOsSecret: secrets.get, setOsSecret: secrets.set, deleteOsSecret: secrets.delete }));
import { clearGoogleDesktopClient, googleDesktopClientState, loadGoogleDesktopClient,
  parseGoogleDesktopClient, saveGoogleDesktopClient } from './oauth-client.js';
import { getGoogleOAuthCredentials, isGoogleOAuthConfigured } from './oauth.js';

const client = { client_id: 'local-client.apps.googleusercontent.com', client_secret: 'isolated-client-secret' };
const json = JSON.stringify({ installed: client });
afterEach(async () => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await clearGoogleDesktopClient(); });

it('validates a desktop client and ignores imported endpoint overrides', () => {
  expect(parseGoogleDesktopClient(JSON.stringify({ installed: { ...client, token_uri: 'https://attacker.invalid' } }))).toEqual(client);
  for (const invalid of ['not-json', '{}', JSON.stringify({ web: client }),
    JSON.stringify({ installed: { client_id: 'https://attacker.invalid' } }),
    JSON.stringify({ installed: { ...client, client_secret: 42 } }), ' '.repeat(65_537)]) {
    expect(() => parseGoogleDesktopClient(invalid)).toThrow('데스크톱 앱');
  }
});

it('persists only the selected client pair and never mixes it with built-in credentials', async () => {
  vi.stubGlobal('__GOOGLE_OAUTH_CLIENT_ID__', 'built-in.apps.googleusercontent.com');
  vi.stubGlobal('__GOOGLE_OAUTH_CLIENT_SECRET__', 'different-secret');
  await saveGoogleDesktopClient(json);
  expect(secrets.set).toHaveBeenCalledWith('google-oauth-client', json);
  expect(getGoogleOAuthCredentials()).toEqual({ clientId: client.client_id, clientSecret: client.client_secret });
  await saveGoogleDesktopClient(JSON.stringify({ installed: { client_id: client.client_id } }));
  expect(getGoogleOAuthCredentials()).toEqual({ clientId: client.client_id });
});

it('preserves the working client if replacement validation or encrypted storage fails', async () => {
  await saveGoogleDesktopClient(json);
  await expect(saveGoogleDesktopClient('{}')).rejects.toThrow();
  secrets.set.mockRejectedValue(new Error('OS encryption unavailable'));
  await expect(saveGoogleDesktopClient(JSON.stringify({ installed: { client_id: 'replacement.apps.googleusercontent.com' } }))).rejects.toThrow();
  expect(googleDesktopClientState().client).toEqual(client);
});

it('loads saved credentials and fails closed on corruption without falling back to another client', async () => {
  secrets.get.mockResolvedValue(json);
  await loadGoogleDesktopClient();
  expect(isGoogleOAuthConfigured()).toBe(true);
  secrets.get.mockRejectedValue(new Error('sensitive detail'));
  vi.stubGlobal('__GOOGLE_OAUTH_CLIENT_ID__', 'built-in.apps.googleusercontent.com');
  await expect(loadGoogleDesktopClient()).rejects.toThrow('다시 가져와');
  expect(isGoogleOAuthConfigured()).toBe(false);
  expect(() => getGoogleOAuthCredentials()).toThrow('다시 가져와');
  expect(googleDesktopClientState().error).not.toContain('sensitive detail');
  await clearGoogleDesktopClient();
  expect(isGoogleOAuthConfigured()).toBe(true);
});

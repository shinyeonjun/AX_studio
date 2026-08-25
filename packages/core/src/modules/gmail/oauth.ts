import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { CodeChallengeMethod } from 'google-auth-library';
import type { GmailConnectorConfig } from './connector.js';
import { GMAIL_OAUTH_SCOPES } from './connection.js';
import type { OAuthCredential } from '../../credentials/types.js';

export interface GmailOAuthOptions {
  clientId: string;
  clientSecret?: string;
  scopes?: readonly string[];
  /** OAuth URL을 브라우저 등으로 열 때 사용 */
  onAuthUrl?: (url: string) => void | Promise<void>;
}

export interface GmailOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  scopes: string[];
}

function generatePkcePair() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function oauthCallbackStateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function connectGmailViaLoopback(options: GmailOAuthOptions): Promise<GmailOAuthResult> {
  const scopes = [...(options.scopes ?? GMAIL_OAUTH_SCOPES)];
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const expectedState = createOAuthState();
  const session: { client?: OAuth2Client } = {};

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400);
        res.end(`OAuth error: ${err}`);
        server.close();
        if (!settled) {
          settled = true;
          reject(new Error(err));
        }
        return;
      }
      if (!oauthCallbackStateMatches(expectedState, url.searchParams.get('state'))) {
        res.writeHead(400);
        res.end('Invalid OAuth state');
        server.close();
        if (!settled) {
          settled = true;
          reject(new Error('Invalid OAuth state'));
        }
        return;
      }
      const authCode = url.searchParams.get('code');
      if (!authCode) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('Gmail 연결 완료. 이 창을 닫고 AX Studio로 돌아가세요.');
      server.close();
      if (!settled) {
        settled = true;
        resolve(authCode);
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to bind loopback port'));
        return;
      }

      const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      session.client = new google.auth.OAuth2(options.clientId, options.clientSecret ?? undefined, redirectUri);
      const authUrl = session.client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: expectedState,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });

      try {
        await options.onAuthUrl?.(authUrl);
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });

  if (!session.client) throw new Error('OAuth client was not initialized');

  const { tokens } = await session.client.getToken({ code, codeVerifier });
  if (!tokens.access_token) throw new Error('No access token returned');
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned. Google 계정 연결을 해제한 뒤 다시 시도하세요.');
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? undefined,
    scopes,
  };
}

export function buildGmailConnectorConfig(params: {
  clientId: string;
  clientSecret?: string;
  credential: OAuthCredential;
  email?: string;
}): GmailConnectorConfig {
  return {
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    refreshToken: params.credential.refreshToken,
    accessToken: params.credential.accessToken,
    expiryDate: params.credential.expiryDate,
    email: params.email,
  };
}

export async function fetchGmailProfileEmail(config: GmailConnectorConfig): Promise<string | undefined> {
  const oauth2 = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauth2.setCredentials({
    access_token: config.accessToken,
    refresh_token: config.refreshToken,
    expiry_date: config.expiryDate,
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress ?? undefined;
}
